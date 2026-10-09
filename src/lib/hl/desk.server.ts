// Paper-trading desk: cycle (sync, FX, manage, signals) and execute (expire, shadow, risk, fill).
// No real orders: everything here writes only to our own paper tables.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { prep, signalsAt, regimeAt, stepPosition, lastClosedDay, type CoinData, type PosState } from "./engine";
import { loadCoinData } from "./backtest.server";
import { syncAll } from "./sync.server";
import { hlInfo } from "./hl-api.server";
import { evaluateEntry, sizePosition, equityUsd, type DeskCfg } from "./risk";

type DB = SupabaseClient<Database>;
type CfgRow = Database["public"]["Tables"]["desk_config"]["Row"];
const H4 = 4 * 3600_000;

// agent_logs.level allows only INFO, SIGNAL, WARNING, ERROR.
const LEVELS: Record<string, string> = { INFO: "INFO", SUCCESS: "INFO", TRADE: "SIGNAL", SIGNAL: "SIGNAL", WARN: "WARNING", ERROR: "ERROR" };
async function log(db: DB, message: string, level = "INFO", metadata?: unknown) {
  const { error } = await db.from("agent_logs").insert({ agent_name: "PAPER DESK", message, level: LEVELS[level] ?? "INFO", market_id: "swing", metadata: (metadata ?? null) as any });
  if (error) console.error("[desk] log insert failed", error.message);
}

async function getCfg(db: DB): Promise<CfgRow> {
  const { data, error } = await db.from("desk_config").select("*").eq("id", 1).single();
  if (error || !data) throw new Error(`desk_config: ${error?.message ?? "missing"}`);
  return data;
}

function toCfg(r: CfgRow): DeskCfg {
  return {
    budget_sek: +r.budget_sek, usd_sek: +(r.usd_sek ?? 0), risk_pct: +r.risk_pct, max_risk_pct: +r.max_risk_pct,
    max_open: r.max_open, min_order_usd: +r.min_order_usd, fee_pct: +r.fee_pct, slip_pct: +r.slip_pct,
    daily_loss_pct: +r.daily_loss_pct, weekly_loss_pct: +r.weekly_loss_pct, kill_drawdown_pct: +r.kill_drawdown_pct,
    night_rule: r.night_rule, mode: r.mode, kill_switch: r.kill_switch,
  };
}

async function refreshFx(db: DB, cfg: CfgRow): Promise<CfgRow> {
  const age = cfg.usd_sek_updated_at ? Date.now() - Date.parse(cfg.usd_sek_updated_at) : Infinity;
  if (cfg.usd_sek && age < 20 * 3600_000) return cfg;
  try {
    const res = await fetch("https://api.frankfurter.app/latest?from=USD&to=SEK");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = (await res.json()) as { rates?: { SEK?: number } };
    const rate = Number(j.rates?.SEK);
    if (!(rate > 0)) throw new Error("no SEK rate");
    const now = new Date().toISOString();
    await db.from("desk_config").update({ usd_sek: rate, usd_sek_updated_at: now }).eq("id", 1);
    await log(db, `USD/SEK refreshed: ${rate}`);
    return { ...cfg, usd_sek: rate, usd_sek_updated_at: now };
  } catch (e) {
    await log(db, `USD/SEK refresh failed, keeping ${cfg.usd_sek ?? "none"}: ${e instanceof Error ? e.message : e}`, "WARN");
    return cfg;
  }
}

/** Manage open paper positions (real + shadow) over newly closed 4H bars — engine's stepPosition. */
async function managePositions(db: DB, data: Map<string, CoinData>, cfg: DeskCfg) {
  const { data: open, error } = await db.from("paper_positions").select("*").eq("status", "open");
  if (error) throw new Error(error.message);
  const costRate = (cfg.fee_pct + cfg.slip_pct) / 100;
  for (const pos of open ?? []) {
    const cd = data.get(pos.coin);
    if (!cd) continue;
    const entryT = Date.parse(pos.entry_t);
    const lastT = pos.last_bar_t ? Date.parse(pos.last_bar_t) : -Infinity;
    const bars = cd.c4h.filter((b) => b.t + H4 > entryT && b.t > lastT);
    if (!bars.length) continue;
    const dir = pos.side === "long" ? 1 : -1;
    const entry = +pos.entry_px;
    const R = Math.abs(entry - +pos.init_stop_px);
    const k = R * +pos.size_coin; // USD per 1R
    const st: PosState = {
      entry, stop: +pos.stop_px, R, t1: +pos.t1_px, t2: +pos.t2_px, dir, t1hit: pos.t1_hit,
      remaining: +pos.remaining_frac, gross: +pos.gross_usd / k, fee: +pos.fees_usd / k, funding: +pos.funding_usd / k, bars: pos.bars_held,
    };
    const wasT1 = st.t1hit;
    let ex: { px: number; reason: string } | null = null;
    let lastBar = lastT;
    for (const b of bars) {
      lastBar = b.t;
      ex = stepPosition(st, b, cd.f4h.get(b.t)?.s ?? 0, costRate);
      if (ex) break;
    }
    const upd: Database["public"]["Tables"]["paper_positions"]["Update"] = {
      t1_hit: st.t1hit, remaining_frac: st.remaining, stop_px: st.stop, bars_held: st.bars,
      last_bar_t: new Date(lastBar).toISOString(), gross_usd: st.gross * k, fees_usd: st.fee * k, funding_usd: st.funding * k,
    };
    const tag = `${pos.shadow ? "[SHADOW] " : ""}${pos.coin} ${pos.side.toUpperCase()} ${pos.setup}`;
    if (ex) {
      const netR = st.gross - st.fee - st.funding;
      Object.assign(upd, { status: "closed", exit_t: new Date(lastBar + H4).toISOString(), exit_px: ex.px, exit_reason: ex.reason, net_usd: netR * k, net_r: netR });
      await log(db, `${tag} closed (${ex.reason}) @ ${ex.px.toPrecision(6)} · ${netR >= 0 ? "+" : ""}${netR.toFixed(2)}R / $${(netR * k).toFixed(2)}`, netR >= 0 ? "SUCCESS" : "WARN");
    } else if (!wasT1 && st.t1hit) {
      await log(db, `${tag} T1 hit — half closed, stop moved to break-even`);
    }
    const { error: e } = await db.from("paper_positions").update(upd).eq("id", pos.id);
    if (e) throw new Error(`paper_positions update: ${e.message}`);
  }
}

/** Signals on the last closed 4H bar per coin, using the engine's signalsAt/regime logic. */
async function generateSignals(db: DB, coins: CoinData[], cfg: CfgRow) {
  const preps = new Map(coins.filter((c) => c.c4h.length && c.c1d.length).map((c) => [c.coin, prep(c)]));
  const btc = preps.get("BTC");
  if (!btc) throw new Error("BTC data missing");
  const latestBarT = Math.max(...Array.from(preps.values()).map((p) => p.c4h[p.c4h.length - 1].t));

  const [{ data: openPos }, { data: pend }, { data: same }, { data: snapT }] = await Promise.all([
    db.from("paper_positions").select("coin").eq("status", "open").eq("shadow", false),
    db.from("signals").select("coin").in("status", ["new", "approved"]),
    db.from("signals").select("coin").eq("signal_bar_t", new Date(latestBarT).toISOString()),
    db.from("hl_universe").select("snapshot_at").order("snapshot_at", { ascending: false }).limit(1),
  ]);
  const blocked = new Set([...(openPos ?? []), ...(pend ?? []), ...(same ?? [])].map((r) => r.coin));
  const uni = new Map<string, any>();
  if (snapT?.[0]) {
    const { data: u } = await db.from("hl_universe").select("*").eq("snapshot_at", snapT[0].snapshot_at);
    for (const r of u ?? []) uni.set(r.coin, r);
  }
  const created: string[] = [];
  for (const coin of Array.from(preps.keys()).sort()) {
    const p = preps.get(coin)!;
    const n = p.c4h.length;
    if (p.c4h[n - 1].t !== latestBarT || blocked.has(coin)) continue;
    // Replay the last 6 days so breakout levels already consumed are marked used, as in the backtest.
    let sig = null;
    for (let i = Math.max(0, n - 37); i < n; i++) {
      const s = signalsAt(p, i, regimeAt(btc, p.c4h[i].t));
      if (i === n - 1) sig = s;
    }
    if (!sig || !cfg.enabled_setups.includes(sig.setup)) continue;
    const i = n - 1;
    const b = p.c4h[i];
    const dd = lastClosedDay(p.d.bars, b.t + H4);
    const dATR = p.d.atr[dd];
    const ref = b.c;
    const R = Math.abs(ref - sig.stop);
    const dir = sig.side === "long" ? 1 : -1;
    if (!dATR || dir * (ref - sig.stop) <= 0 || R < dATR || R > 3 * dATR) {
      await log(db, `${coin} ${sig.setup} signal skipped: stop distance outside 1–3× daily ATR`);
      continue;
    }
    const riskOn = regimeAt(btc, b.t);
    const u = uni.get(coin);
    const { error } = await db.from("signals").insert({
      coin, setup: sig.setup, side: sig.side, signal_bar_t: new Date(b.t).toISOString(),
      ref_px: ref, stop_px: sig.stop, t1_px: ref + dir * 1.5 * R, t2_px: ref + dir * 3 * R, stop_dist_pct: R / ref,
      regime: riskOn == null ? "unknown" : riskOn ? "risk_on" : "risk_off",
      context: {
        funding_24h: p.fund24[i], open_interest: u?.open_interest ?? null, day_ntl_vlm: u?.day_ntl_vlm ?? null, mark_px: u?.mark_px ?? null,
        daily_atr: dATR, daily_ema50: p.d.ema50[dd], daily_ema200: p.d.ema200[dd], h4_ema20: p.ema20[i], h4_ema50: p.ema50[i], h4_atr: p.atr4[i],
      } as any,
    });
    if (error) throw new Error(`signals insert: ${error.message}`);
    created.push(`${coin} ${sig.side} ${sig.setup}`);
    await log(db, `NEW SIGNAL ${coin} ${sig.side.toUpperCase()} ${sig.setup} @ ${ref} stop ${sig.stop.toPrecision(6)} — awaiting review`, "SIGNAL");
  }
  return created;
}

async function realized(db: DB) {
  const { data } = await db.from("paper_positions").select("net_usd,exit_t").eq("status", "closed").eq("shadow", false);
  const now = Date.now();
  let all = 0, day = 0, week = 0;
  for (const r of data ?? []) {
    const v = +(r.net_usd ?? 0);
    all += v;
    const t = r.exit_t ? Date.parse(r.exit_t) : 0;
    if (t >= now - 86400_000) day += v;
    if (t >= now - 7 * 86400_000) week += v;
  }
  return { all, day, week };
}

async function snapshot(db: DB, cfgRow: CfgRow, note: string) {
  if (!cfgRow.usd_sek) return;
  const cfg = toCfg(cfgRow);
  const r = await realized(db);
  const eq = equityUsd(cfg, r.all);
  const { data: open } = await db.from("paper_positions").select("entry_px,stop_px,size_coin,remaining_frac,side").eq("status", "open").eq("shadow", false);
  const openRisk = (open ?? []).reduce((a, p) => {
    const dir = p.side === "long" ? 1 : -1;
    return a + Math.max(0, dir * (+p.entry_px - +p.stop_px)) * +p.size_coin * +p.remaining_frac;
  }, 0);
  await db.from("paper_equity").insert({ equity_usd: eq, open_risk_usd: openRisk, note });
  await db.from("markets").update({ current_sek: Math.round(eq * cfg.usd_sek * 100) / 100, seed_sek: cfg.budget_sek, updated_at: new Date().toISOString() }).eq("id", "swing");
}

export async function runCycle(db: DB) {
  const out: Record<string, unknown> = {};
  try {
    const { data: last } = await db.from("hl_universe").select("snapshot_at").order("snapshot_at", { ascending: false }).limit(1);
    const lastT = last?.[0]?.snapshot_at ? Date.parse(last[0].snapshot_at) : 0;
    if (Date.now() - lastT < 30 * 60_000) out.sync = "skipped (synced < 30 min ago)";
    else out.sync = `${(await syncAll(db)).coins.length} coins`;
  } catch (e) {
    out.sync = `error: ${e instanceof Error ? e.message : e}`;
    await log(db, `Market sync failed: ${out.sync}`, "ERROR");
  }
  const cfgRow = await refreshFx(db, await getCfg(db));
  out.usd_sek = cfgRow.usd_sek;
  const coins = await loadCoinData(db);
  await managePositions(db, new Map(coins.map((c) => [c.coin, c])), toCfg(cfgRow));
  out.signals = await generateSignals(db, coins, cfgRow);
  await snapshot(db, cfgRow, "cycle");
  await log(db, `Cycle done · sync ${out.sync} · ${(out.signals as string[]).length} new signal(s)`);
  return out;
}

export async function runExecute(db: DB) {
  const cfgRow = await getCfg(db);
  if (!cfgRow.usd_sek) {
    await log(db, "Execute skipped: no USD/SEK rate yet", "ERROR");
    return { error: "no usd_sek" };
  }
  const cfg = toCfg(cfgRow);
  const now = new Date();
  const out = { expired: 0, shadow: [] as string[], executed: [] as string[], rejected: [] as string[] };

  const cutoff = new Date(now.getTime() - cfgRow.review_window_minutes * 60_000).toISOString();
  const { data: exp } = await db.from("signals").update({ status: "expired" }).eq("status", "new").lt("created_at", cutoff).select("coin,setup");
  out.expired = exp?.length ?? 0;
  for (const s of exp ?? []) await log(db, `Signal ${s.coin} ${s.setup} expired (no review in ${cfgRow.review_window_minutes} min)`, "WARN");

  const mids = await hlInfo<Record<string, string>>({ type: "allMids" });
  const r = await realized(db);
  const equity = equityUsd(cfg, r.all);

  // Vetoed -> shadow position (comparison only)
  const { data: vetoed } = await db.from("signals").select("*").eq("status", "vetoed").gte("created_at", new Date(now.getTime() - 2 * 86400_000).toISOString());
  const { data: haveShadow } = await db.from("paper_positions").select("signal_id").eq("shadow", true);
  const shadowed = new Set((haveShadow ?? []).map((x) => x.signal_id));
  for (const s of vetoed ?? []) {
    if (shadowed.has(s.id)) continue;
    const mark = Number(mids[s.coin]);
    if (!(mark > 0)) continue;
    const z = sizePosition(cfg, s.coin, s.side as "long" | "short", mark, +s.stop_px, equity, 0);
    if (!z.ok) { await log(db, `[SHADOW] ${s.coin} ${s.setup} not opened: ${z.reason}`, "WARN"); continue; }
    await insertPosition(db, s, z, true, now, cfg);
    out.shadow.push(s.coin);
    await log(db, `[SHADOW] ${s.coin} ${s.side.toUpperCase()} ${s.setup} opened @ ${z.entry.toPrecision(6)} (vetoed, tracked for comparison)`);
  }

  // Approved -> risk manager -> real paper position
  const { data: approved } = await db.from("signals").select("*").eq("status", "approved").order("created_at").order("coin");
  const { data: openReal } = await db.from("paper_positions").select("margin_usd").eq("status", "open").eq("shadow", false);
  const { data: peakRow } = await db.from("paper_equity").select("equity_usd").order("equity_usd", { ascending: false }).limit(1);
  const open_real = (openReal ?? []).map((p) => ({ margin_usd: +p.margin_usd }));
  for (const s of approved ?? []) {
    const mark = Number(mids[s.coin]);
    const res = !(mark > 0)
      ? { ok: false as const, reason: "no mark price" }
      : evaluateEntry({
          cfg, now, coin: s.coin, side: s.side as "long" | "short", ref_px: +s.ref_px, stop_px: +s.stop_px, mark,
          crowding_flag: (s.review as any)?.crowding_flag === true, open_real,
          realized_net_usd: r.all, day_net_usd: r.day, week_net_usd: r.week, peak_equity_usd: +(peakRow?.[0]?.equity_usd ?? 0),
        });
    if (!res.ok) {
      await db.from("signals").update({ status: "rejected_by_risk", risk_note: res.reason }).eq("id", s.id);
      if ("kill" in res && res.kill) { await db.from("desk_config").update({ kill_switch: true }).eq("id", 1); cfg.kill_switch = true; }
      out.rejected.push(`${s.coin}: ${res.reason}`);
      await log(db, `RISK REJECTED ${s.coin} ${s.setup}: ${res.reason}`, "WARN");
      continue;
    }
    await insertPosition(db, s, res, false, now, cfg);
    await db.from("signals").update({ status: "executed" }).eq("id", s.id);
    open_real.push({ margin_usd: res.margin_usd });
    out.executed.push(s.coin);
    await log(db, `PAPER FILL ${s.coin} ${s.side.toUpperCase()} ${s.setup} @ ${res.entry.toPrecision(6)} · $${res.notional_usd.toFixed(2)} notional · risk $${res.risk_usd.toFixed(2)} · ${res.leverage}x cap`, "TRADE");
  }
  await snapshot(db, { ...cfgRow, kill_switch: cfg.kill_switch }, "execute");
  await log(db, `Execute done · ${out.expired} expired · ${out.shadow.length} shadow · ${out.executed.length} filled · ${out.rejected.length} rejected`);
  return out;
}

async function insertPosition(db: DB, s: any, z: ReturnType<typeof sizePosition> & { ok: true }, shadow: boolean, now: Date, cfg: DeskCfg) {
  const { error } = await db.from("paper_positions").insert({
    signal_id: s.id, shadow, coin: s.coin, side: s.side, setup: s.setup, entry_t: now.toISOString(), entry_px: z.entry,
    init_stop_px: +s.stop_px, stop_px: +s.stop_px, t1_px: z.t1, t2_px: z.t2, size_coin: z.size_coin, notional_usd: z.notional_usd,
    margin_usd: z.margin_usd, leverage: z.leverage, risk_usd: z.risk_usd, fees_usd: (z.notional_usd * cfg.fee_pct) / 100,
  });
  if (error) throw new Error(`paper_positions insert: ${error.message}`);
}
