// Live tracking of watchlist wallets -> sm_events -> 'smart_money_follow' signals; follow-exits for paper positions.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { hlInfo } from "@/lib/hl/hl-api.server";
import { atr, type Bar } from "@/lib/hl/engine";
import { liquidCoins } from "./deep.server";
import { smLog } from "./candidates.server";

import { mimicStep, mimicCoins, type TrackEvent } from "./mimic.server";

type DB = SupabaseClient<Database>;
/** Minimum position size (share of account value) for a scouted Invo trader's open to become a follow signal. */
export const SCOUT_MIN_FRAC = 0.005;
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

/** Lease in sm_jobs so overlapping cron runs (every minute) never process the same snapshot twice. */
async function takeLease(db: DB, name: string, ms: number): Promise<boolean> {
  const now = new Date().toISOString();
  await db.from("sm_jobs").upsert({ name, state: { until: "1970-01-01T00:00:00.000Z" } as never, updated_at: now }, { onConflict: "name", ignoreDuplicates: true });
  const { data } = await db.from("sm_jobs").update({ state: { until: new Date(Date.now() + ms).toISOString() } as never, updated_at: now })
    .eq("name", name).lt("state->>until", now).select("name");
  return !!data?.length;
}
const releaseLease = (db: DB, name: string) =>
  db.from("sm_jobs").update({ state: { until: "1970-01-01T00:00:00.000Z" } as never, updated_at: new Date().toISOString() }).eq("name", name);

export async function trackWatchlist(db: DB) {
  if (!(await takeLease(db, "track_lock", 4 * 60_000))) return { skipped: "previous run still busy" };
  try { return await trackOnce(db); } finally { await releaseLease(db, "track_lock"); }
}

async function trackOnce(db: DB) {
  // Watched wallets (follow signals) plus mirrored Invo traders (Mimic simulator).
  const { data: wl } = await db.from("sm_scores").select("address,tier,score,tracked_at,mirror").or("watchlist.eq.true,mirror.eq.true");
  const events: TrackEvent[] = [];
  const nowIso = new Date().toISOString();
  for (const w of wl ?? []) {
    // Invo portfolios ("invo:<id>") are snapshotted by the Invo bridge (invo-bridge.server.ts), not read on-chain.
    if (w.address.startsWith("invo:")) continue;
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
  if (wlSet.length) {
    const inList = `(${wlSet.map((a) => `"${a}"`).join(",")})`;
    await db.from("sm_positions").delete().not("address", "in", inList);
    // A dropped snapshot means a fresh baseline if the wallet comes back, never "everything it holds is new".
    await db.from("sm_scores").update({ tracked_at: null }).not("tracked_at", "is", null).not("address", "in", inList);
  }

  const signals = await followSignals(db);
  const exits = await followExits(db);
  const { checkBridgeHealth } = await import("./invo-bridge.server");
  const bridge = await checkBridgeHealth(db).catch(() => null);
  const mirror = new Set((wl ?? []).filter((w) => w.mirror).map((w) => w.address));
  let mimic: unknown = null;
  if (mirror.size || events.length) {
    const [mids, tradable] = await Promise.all([hlInfo<Record<string, string>>({ type: "allMids" }), mimicCoins(db as never)]);
    mimic = await mimicStep(db as never, events, mirror, mids, tradable);
  }
  return { wallets: wl?.length ?? 0, mirror: mirror.size, events: events.length, signals, exits, mimic, bridge };
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
  // Owner-scouted Invo traders: large accounts that size positions at 1-2% of equity, so their floor is lower.
  const { data: scoutRows } = await db.from("sm_wallets").select("address,display_name").contains("sources", ["invo_scout"]);
  const scouted = new Map((scoutRows ?? []).map((w) => [w.address, w.display_name]));
  for (const e of evs) {
    const key = `${e.coin}|${e.side}`;
    if (!liquid.has(e.coin) || created.some((c) => c.startsWith(e.coin + " "))) continue;
    // Invo portfolios (bridge) count every open; scouted wallets from 0.5% of account value; others from 2%.
    if (!e.address.startsWith("invo:") && (e.notional_frac ?? 0) < (scouted.has(e.address) ? SCOUT_MIN_FRAC : 0.02)) continue;
    const src = sm.get(e.address);
    const { data: holders } = await db.from("sm_positions").select("*").eq("coin", e.coin).eq("side", e.side);
    // Consensus counts only full-bar wallets; practice wallets never make a real follow signal.
    const near = (holders ?? []).filter((h) => sm.has(h.address) && !sm.get(h.address)!.practice && Math.abs(Date.parse(h.opened_at) - Date.parse(e.t)) <= 12 * 3600_000);
    const tierA = src?.tier === "A" && !src.practice;
    const real = realOn && !!src && !src.practice && (tierA || near.length >= 2);
    const practice = !real && practiceOn && !!src; // any other watchlist open: paper-only practice follow
    if (!real && !practice) continue;
    const setup = real ? "smart_money_follow" : "practice_follow";
    const trigger = real ? (tierA ? "tier_a_open" : "consensus") : scouted.has(e.address) ? "invo_scout_open" : "practice_open";
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
        median_hold_h: st?.median_hold_h, entry_px: h?.entry_px ?? e.entry_px, invo_user: scouted.get(a) ?? null };
    });
    const { error } = await db.from("signals").insert({
      coin: e.coin, setup, side: e.side, signal_bar_t: e.t, ref_px: mark, stop_px: mark - dir * R,
      t1_px: mark + dir * 1.5 * R, t2_px: mark + dir * 3 * R, stop_dist_pct: R / mark, regime: trigger,
      context: { trigger, practice: !real, wallets, funding: u?.[0]?.funding ?? null, open_interest: u?.[0]?.open_interest ?? null, daily_atr: dAtr } as any,
    });
    if (error) { await smLog(db, `follow signal insert failed: ${error.message}`, "ERROR"); continue; }
    created.push(`${e.coin} ${e.side}`);
    await smLog(db, `NEW SIGNAL ${e.coin} ${e.side.toUpperCase()} ${setup} (${real ? (tierA ? "tier A open" : `${near.length} wallets`) : scouted.has(e.address) ? `practice: scouted Invo trader ${scouted.get(e.address) ?? e.address.slice(0, 8)}` : "practice: one watched wallet below the full bar"}) @ ${mark} — awaiting review`, "SIGNAL");
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
