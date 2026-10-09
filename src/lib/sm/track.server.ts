// Live tracking of watchlist wallets -> sm_events -> 'smart_money_follow' signals; follow-exits for paper positions.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { hlInfo } from "@/lib/hl/hl-api.server";
import { atr, type Bar } from "@/lib/hl/engine";
import { liquidCoins } from "./deep.server";
import { smLog } from "./candidates.server";

import { mimicStep, type TrackEvent } from "./mimic.server";

type DB = SupabaseClient<Database>;
type CH = {
  marginSummary: { accountValue: string };
  assetPositions: { position: { coin: string; szi: string; entryPx: string | null; positionValue: string; leverage?: { value: number } } }[];
};

/** R = 1.5 x daily ATR(14) from the last 30 closed daily candles. */
export async function dailyAtr(coin: string): Promise<number | null> {
  const now = Date.now();
  const k = await hlInfo<{ t: number; o: string; h: string; l: string; c: string; v: string }[]>({
    type: "candleSnapshot", req: { coin, interval: "1d", startTime: now - 40 * 86400_000, endTime: now },
  });
  const bars: Bar[] = k.filter((b) => b.t + 86400_000 <= now).map((b) => ({ t: b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v }));
  const a = atr(bars, 14);
  return a[a.length - 1] ?? null;
}

export async function trackWatchlist(db: DB) {
  // Watched wallets (follow signals) plus mirrored Invo traders (Mimic simulator).
  const { data: wl } = await db.from("sm_scores").select("address,tier,score,tracked_at,mirror").or("watchlist.eq.true,mirror.eq.true");
  const events: TrackEvent[] = [];
  const nowIso = new Date().toISOString();
  for (const w of wl ?? []) {
    let ch: CH;
    try { ch = await hlInfo<CH>({ type: "clearinghouseState", user: w.address }); } catch { continue; }
    const av = +ch.marginSummary.accountValue;
    // First look at a newly watched wallet: record what it already holds as the baseline, without events, so positions it
    // opened days ago never become follow signals. Only opens seen after this count.
    const baseline = !w.tracked_at;
    const { data: prev } = await db.from("sm_positions").select("*").eq("address", w.address);
    const pm = new Map((prev ?? []).map((p) => [p.coin, p]));
    const seen = new Set<string>();
    for (const { position: p } of ch.assetPositions) {
      const szi = +p.szi; if (!szi) continue;
      seen.add(p.coin);
      const side = szi > 0 ? "long" : "short";
      const notional = Math.abs(+p.positionValue);
      const old = pm.get(p.coin);
      let kind: string | null = null, size = Math.abs(szi), openedAt = old?.opened_at ?? nowIso;
      if (!old) kind = "open";
      else if (old.side !== side) { kind = "open"; openedAt = nowIso; events.push({ address: w.address, coin: p.coin, side: old.side, kind: "close" });
        await db.from("sm_events").insert({ address: w.address, coin: p.coin, side: old.side, kind: "close", size: Math.abs(+old.szi), entry_px: old.entry_px }); }
      else if (Math.abs(szi) > Math.abs(+old.szi) * 1.0001) { kind = "increase"; size = Math.abs(szi) - Math.abs(+old.szi); }
      else if (Math.abs(szi) < Math.abs(+old.szi) * 0.9999) { kind = "reduce"; size = Math.abs(+old.szi) - Math.abs(szi); }
      if (kind && !baseline) {
        await db.from("sm_events").insert({ address: w.address, coin: p.coin, side, kind, size, entry_px: p.entryPx ? +p.entryPx : null,
          leverage: p.leverage?.value ?? null, notional_frac: av > 0 ? notional / av : null });
        events.push({ address: w.address, coin: p.coin, side, kind, entry_px: p.entryPx ? +p.entryPx : null, leverage: p.leverage?.value ?? null });
      }
      await db.from("sm_positions").upsert({ address: w.address, coin: p.coin, side, szi, entry_px: p.entryPx ? +p.entryPx : null, notional,
        leverage: p.leverage?.value ?? null, account_value: av, opened_at: kind === "open" ? nowIso : openedAt, updated_at: nowIso });
    }
    if (baseline) await db.from("sm_scores").update({ tracked_at: nowIso }).eq("address", w.address);
    for (const old of prev ?? []) {
      if (seen.has(old.coin)) continue;
      await db.from("sm_events").insert({ address: w.address, coin: old.coin, side: old.side, kind: "close", size: Math.abs(+old.szi), entry_px: old.entry_px });
      await db.from("sm_positions").delete().eq("address", w.address).eq("coin", old.coin);
      events.push({ address: w.address, coin: old.coin, side: old.side, kind: "close" });
    }
  }
  // Drop snapshots of wallets that left the watchlist.
  const wlSet = (wl ?? []).map((w) => w.address);
  if (wlSet.length) await db.from("sm_positions").delete().not("address", "in", `(${wlSet.map((a) => `"${a}"`).join(",")})`);

  const signals = await followSignals(db);
  const exits = await followExits(db);
  const mirror = new Set((wl ?? []).filter((w) => w.mirror).map((w) => w.address));
  let mimic: unknown = null;
  if (mirror.size || events.length) {
    const [mids, liquid] = await Promise.all([hlInfo<Record<string, string>>({ type: "allMids" }), liquidCoins(db)]);
    mimic = await mimicStep(db as never, events, mirror, mids, liquid);
  }
  return { wallets: wl?.length ?? 0, mirror: mirror.size, events: events.length, signals, exits, mimic };
}

async function followSignals(db: DB) {
  const { data: cfg } = await db.from("desk_config").select("enabled_setups,kill_switch").eq("id", 1).single();
  const realOn = !!cfg?.enabled_setups.includes("smart_money_follow"), practiceOn = !!cfg?.enabled_setups.includes("practice_follow");
  if (!realOn && !practiceOn) return [];
  const { data: evs } = await db.from("sm_events").select("*").eq("processed", false).eq("kind", "open").order("t");
  if (!evs?.length) return [];
  await db.from("sm_events").update({ processed: true }).in("id", evs.map((e) => e.id));
  const liquid = await liquidCoins(db);
  const { data: scores } = await db.from("sm_scores").select("address,tier,score,watchlist,practice").eq("watchlist", true);
  const sm = new Map((scores ?? []).map((s) => [s.address, s]));
  const created: string[] = [];
  const mids = await hlInfo<Record<string, string>>({ type: "allMids" });
  for (const e of evs) {
    const key = `${e.coin}|${e.side}`;
    if (!liquid.has(e.coin) || created.some((c) => c.startsWith(e.coin + " "))) continue;
    if ((e.notional_frac ?? 0) < 0.02) continue;
    const src = sm.get(e.address);
    const { data: holders } = await db.from("sm_positions").select("*").eq("coin", e.coin).eq("side", e.side);
    // Consensus counts only full-bar wallets; practice wallets never make a real follow signal.
    const near = (holders ?? []).filter((h) => sm.has(h.address) && !sm.get(h.address)!.practice && Math.abs(Date.parse(h.opened_at) - Date.parse(e.t)) <= 12 * 3600_000);
    const tierA = src?.tier === "A" && !src.practice;
    const real = realOn && !!src && !src.practice && (tierA || near.length >= 2);
    const practice = !real && practiceOn && !!src; // any other watchlist open: paper-only practice follow
    if (!real && !practice) continue;
    const setup = real ? "smart_money_follow" : "practice_follow";
    const trigger = real ? (tierA ? "tier_a_open" : "consensus") : "practice_open";
    const [{ data: openSig }, { data: openPos }] = await Promise.all([
      db.from("signals").select("id").eq("coin", e.coin).in("status", ["new", "approved"]).limit(1),
      db.from("paper_positions").select("id").eq("coin", e.coin).eq("status", "open").eq("shadow", false).limit(1),
    ]);
    if (openSig?.length || openPos?.length) continue;
    const mark = Number(mids[e.coin]);
    const dAtr = await dailyAtr(e.coin);
    if (!(mark > 0) || !dAtr) continue;
    const R = 1.5 * dAtr, dir = e.side === "long" ? 1 : -1;
    const walletAddrs = real ? Array.from(new Set([e.address, ...near.map((h) => h.address)])) : [e.address];
    const [{ data: wss }, { data: wws }, { data: u }] = await Promise.all([
      db.from("sm_wallet_stats").select("address,win_rate,profit_factor,median_hold_h").in("address", walletAddrs),
      db.from("sm_wallets").select("address,sources").in("address", walletAddrs),
      db.from("hl_universe").select("funding,open_interest,snapshot_at").eq("coin", e.coin).order("snapshot_at", { ascending: false }).limit(1),
    ]);
    const wallets = walletAddrs.map((a) => {
      const st = wss?.find((x) => x.address === a), wv = wws?.find((x) => x.address === a), sc = sm.get(a), h = holders?.find((x) => x.address === a);
      return { address: a, source: wv?.sources ?? [], tier: sc?.practice ? "practice" : sc?.tier, score: sc?.score, win_rate: st?.win_rate, profit_factor: st?.profit_factor,
        median_hold_h: st?.median_hold_h, entry_px: h?.entry_px ?? e.entry_px };
    });
    const { error } = await db.from("signals").insert({
      coin: e.coin, setup, side: e.side, signal_bar_t: e.t, ref_px: mark, stop_px: mark - dir * R,
      t1_px: mark + dir * 1.5 * R, t2_px: mark + dir * 3 * R, stop_dist_pct: R / mark, regime: trigger,
      context: { trigger, practice: !real, wallets, funding: u?.[0]?.funding ?? null, open_interest: u?.[0]?.open_interest ?? null, daily_atr: dAtr } as any,
    });
    if (error) { await smLog(db, `follow signal insert failed: ${error.message}`, "ERROR"); continue; }
    created.push(`${e.coin} ${e.side}`);
    await smLog(db, `NEW SIGNAL ${e.coin} ${e.side.toUpperCase()} ${setup} (${real ? (tierA ? "tier A open" : `${near.length} wallets`) : "practice: one watched wallet below the full bar"}) @ ${mark} — awaiting review`, "SIGNAL");
    void key;
  }
  return created;
}

/** Close paper follow positions once every source wallet has closed its position (paper fill at mark). */
async function followExits(db: DB) {
  const { data: open } = await db.from("paper_positions").select("*").eq("status", "open").in("setup", ["smart_money_follow", "practice_follow"]);
  if (!open?.length) return [];
  const mids = await hlInfo<Record<string, string>>({ type: "allMids" });
  const { data: cfg } = await db.from("desk_config").select("fee_pct,slip_pct").eq("id", 1).single();
  const cost = ((+(cfg?.fee_pct ?? 0.045)) + (+(cfg?.slip_pct ?? 0.05))) / 100;
  const closed: string[] = [];
  for (const p of open) {
    const ws = p.follow_wallets ?? [];
    if (!ws.length) continue;
    const { data: still } = await db.from("sm_positions").select("address").eq("coin", p.coin).eq("side", p.side).in("address", ws);
    if (still?.length) continue;
    const px = Number(mids[p.coin]); if (!(px > 0)) continue;
    const dir = p.side === "long" ? 1 : -1;
    const remSize = +p.size_coin * +p.remaining_frac;
    const gross = +p.gross_usd + dir * (px - +p.entry_px) * remSize;
    const fees = +p.fees_usd + cost * px * remSize;
    const net = gross - fees - +p.funding_usd;
    const k = Math.abs(+p.entry_px - +p.init_stop_px) * +p.size_coin;
    await db.from("paper_positions").update({ status: "closed", exit_t: new Date().toISOString(), exit_px: px, exit_reason: "follow_exit",
      gross_usd: gross, fees_usd: fees, net_usd: net, net_r: k ? net / k : null, remaining_frac: 0 }).eq("id", p.id);
    closed.push(p.coin);
    await smLog(db, `${p.shadow ? "[SHADOW] " : ""}${p.coin} ${p.side.toUpperCase()} ${p.setup} closed (source wallets exited) @ ${px} · $${net.toFixed(2)}`, net >= 0 ? "INFO" : "WARNING");
  }
  return closed;
}
