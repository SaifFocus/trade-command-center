// LIVE desk: real orders on Hyperliquid. Off unless desk_config.live_armed = true.
// - executeLive: called by the hourly execute pass for each signal the paper desk just filled.
// - reconcileLive: every 2 minutes (cron live-reconcile). Syncs fills, keeps a stop on every position,
//   moves to break-even at T1, mirrors the paper twin's time/follow exits, retries unfinished closes,
//   and trips the kill switch.
// - killLive: cancel everything, close everything, back to paper. Runs whenever kill_switch is set.
// executeLive and reconcileLive share a database lease (live_lock) so they never act on a stale view.
// Rules live in live-risk.ts (pure, tested); exchange I/O in hl-exchange.server.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatPrice } from "@nktkas/hyperliquid/utils";
import {
  liveEntryBlock, sizeLive, entryOrder, protectiveOrders, triggerOrder, closeOrder, equityTrips, planReconcile,
  perpTransferUsd, liveEquityUsd, newCloid, stockholmDay, HARD, type LiveCfg, type LivePos, type OrderSpec, type Side, type Action,
} from "./live-risk";
import { liveExchange, readLiveEnv, type LiveExchange, type MarketInfo, type PlaceResult } from "./hl-exchange.server";

// The generated Database type is regenerated after the migration; until then use a loose client type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type State = Awaited<ReturnType<LiveExchange["state"]>>;

const ACTIVE = ["opening", "open", "closing"];
const MIRRORED_PAPER_EXITS = ["time_stop", "max_hold", "follow_exit"];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const LEVELS: Record<string, string> = { INFO: "INFO", TRADE: "SIGNAL", WARN: "WARNING", ERROR: "ERROR" };
async function log(db: DB, message: string, level: keyof typeof LEVELS = "INFO", metadata?: unknown) {
  const { error } = await db.from("agent_logs").insert({
    agent_name: "LIVE DESK", message, level: LEVELS[level] ?? "INFO", market_id: "swing", metadata: (metadata ?? null) as never,
  });
  if (error) console.error("[live] log insert failed", error.message);
}

async function getCfg(db: DB): Promise<Row> {
  const { data, error } = await db.from("desk_config").select("*").eq("id", 1).single();
  if (error || !data) throw new Error(`desk_config: ${error?.message ?? "missing"}`);
  return data;
}

async function activeRows(db: DB): Promise<Row[]> {
  const { data, error } = await db.from("live_positions").select("*").in("status", ACTIVE);
  if (error) throw new Error(`live_positions: ${error.message}`);
  return data ?? [];
}

// ---- lease shared by executeLive and reconcileLive ----
async function acquire(db: DB, owner: string, seconds: number, waitMs: number): Promise<boolean> {
  const until = Date.now() + waitMs;
  for (;;) {
    const { data, error } = await db.rpc("live_lock", { p_owner: owner, p_seconds: seconds });
    if (error) throw new Error(`live_lock: ${error.message}`);
    if (data === true) return true;
    if (Date.now() >= until) return false;
    await sleep(2000);
  }
}
async function release(db: DB, owner: string) {
  await db.rpc("live_unlock", { p_owner: owner });
}

export function toLiveCfg(r: Row): LiveCfg {
  return {
    budget_sek: +r.budget_sek, usd_sek: +(r.usd_sek ?? 0), risk_pct: +r.risk_pct, max_risk_pct: +r.max_risk_pct, max_open: +r.max_open,
    min_order_usd: +r.min_order_usd, fee_pct: +r.fee_pct, slip_pct: +r.slip_pct, daily_loss_pct: +r.daily_loss_pct,
    weekly_loss_pct: +r.weekly_loss_pct, kill_drawdown_pct: +r.kill_drawdown_pct, night_rule: !!r.night_rule, kill_switch: !!r.kill_switch,
    live_armed: !!r.live_armed, live_whitelist: (r.live_whitelist ?? []) as string[], live_min_volume_usd: +(r.live_min_volume_usd ?? 1e7),
    max_entries_per_day: +(r.max_entries_per_day ?? 6),
  };
}

function toLivePos(r: Row): LivePos {
  return {
    id: r.id, coin: r.coin, side: r.side, setup: r.setup, status: r.status, entry_t: r.entry_t, entry_px: +(r.entry_px ?? 0),
    size: +(r.size ?? 0), stop_px: +r.stop_px, t1_px: +(r.t1_px ?? 0), t2_px: +(r.t2_px ?? 0), be_moved: !!r.be_moved, t1_done: !!r.t1_done,
    sl_oid: r.sl_oid == null ? null : Number(r.sl_oid), t1_oid: r.t1_oid == null ? null : Number(r.t1_oid), t2_oid: r.t2_oid == null ? null : Number(r.t2_oid),
    close_reason: r.close_reason ?? null,
  };
}

async function recordOrder(db: DB, ex: LiveExchange, positionId: string | null, o: OrderSpec, res: PlaceResult | { status: "dry_run" }, cloid?: string) {
  const r = res as PlaceResult & { status: string };
  await db.from("live_orders").insert({
    position_id: positionId, kind: o.kind, coin: o.coin, is_buy: o.isBuy, px: +o.px, size: +o.size,
    trigger_px: o.trigger ? +o.trigger.triggerPx : null, reduce_only: o.reduceOnly, oid: "oid" in r ? r.oid : null, cloid: cloid ?? null,
    status: r.status, error: "error" in r ? r.error : null, raw: ("raw" in r ? r.raw : null) as never, network: ex.network, dry_run: ex.dryRun,
  });
}

async function updatePos(db: DB, id: string, patch: Row) {
  const { error } = await db.from("live_positions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(`live_positions update: ${error.message}`);
}

/**
 * Close whatever is open on `coin` with reduce-only IOC orders, re-reading the exchange size before every
 * attempt (no float subtraction) and widening the price up to 3 times. Returns the size still open.
 */
async function closeAtMarket(db: DB, ex: LiveExchange, m: MarketInfo, positionId: string | null): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [st, mids] = await Promise.all([ex.state(), ex.mids()]);
    const p = st.positions.find((x) => x.coin === m.coin && x.szi !== 0);
    if (!p) return 0;
    const side: Side = p.szi > 0 ? "long" : "short";
    const o = closeOrder(m, side, Math.abs(p.szi), mids[m.coin] || m.mark, attempt);
    const res = await ex.place(o);
    await recordOrder(db, ex, positionId, o, res);
    if (res.status === "unknown") await sleep(1500);
  }
  const st = await ex.state();
  return Math.abs(st.positions.find((x) => x.coin === m.coin)?.szi ?? 0);
}

/** Stop, then T1/T2 for a fresh fill. A position must never sit without a stop: if the stop fails, close it. */
async function protect(db: DB, ex: LiveExchange, m: MarketInfo, pos: Row, side: Side, size: number, fillPx: number, stopPx: number, minOrderUsd: number) {
  const plan = protectiveOrders(m, side, size, fillPx, stopPx, minOrderUsd);
  const sl = await ex.place(plan.sl);
  await recordOrder(db, ex, pos.id, plan.sl, sl);
  if (sl.status !== "resting") {
    await log(db, `${m.coin}: STOP ORDER FAILED (${"error" in sl ? sl.error : sl.status}) — closing the position now`, "ERROR");
    await updatePos(db, pos.id, { status: "closing", close_reason: "protect_failed", size, entry_px: fillPx, init_size: size });
    const left = await closeAtMarket(db, ex, m, pos.id);
    if (left > 0) await log(db, `${m.coin}: ${left} still open after 3 close attempts; reconcile keeps retrying every 2 minutes`, "ERROR");
    return { ok: false as const };
  }
  let t1Oid: number | null = null;
  if (plan.t1) {
    const t1 = await ex.place(plan.t1);
    await recordOrder(db, ex, pos.id, plan.t1, t1);
    if (t1.status === "resting") t1Oid = t1.oid;
  }
  const t2Spec = t1Oid == null ? triggerOrder("t2", m, side, size, plan.t2Px) : plan.t2;
  let t2 = await ex.place(t2Spec);
  await recordOrder(db, ex, pos.id, t2Spec, t2);
  if (t2.status !== "resting") {
    t2 = await ex.place(t2Spec);
    await recordOrder(db, ex, pos.id, t2Spec, t2);
  }
  if (t2.status !== "resting") await log(db, `${m.coin}: T2 order not accepted; APEX closes at T2 by price`, "WARN");
  return { ok: true as const, slOid: sl.oid, t1Oid, t2Oid: t2.status === "resting" ? t2.oid : null, t1Px: plan.t1Px, t2Px: plan.t2Px };
}

export type LiveResult = { status: "filled" | "skipped" | "missed" | "error" | "dry_run" | "pending"; note: string; orders?: OrderSpec[] };

/** Open a real position for a signal the paper desk just filled. Never throws: errors come back as a result. */
export async function executeLive(db: DB, signal: Row, opts: { ex?: LiveExchange | null; paperPositionId?: string | null } = {}): Promise<LiveResult> {
  const done = async (res: LiveResult) => {
    await db.from("signals").update({ live_note: `${res.status.toUpperCase()}: ${res.note}` }).eq("id", signal.id);
    await log(db, `LIVE ${res.status.toUpperCase()} ${signal.coin} ${signal.side} ${signal.setup}: ${res.note}`,
      res.status === "filled" ? "TRADE" : res.status === "error" ? "ERROR" : res.status === "skipped" ? "INFO" : "WARN");
    return res;
  };
  const owner = `execute:${signal.id}`;
  let locked = false;
  try {
    const ex = opts.ex === undefined ? liveExchange() : opts.ex;
    if (!ex) return await done({ status: "skipped", note: "live trading is not configured (secrets missing)" });
    locked = await acquire(db, owner, 300, 60_000);
    if (!locked) return await done({ status: "skipped", note: "another live job is running; signal not taken" });
    const r = await getCfg(db);
    const cfg = toLiveCfg(r);
    const side = signal.side as Side;
    const act = await activeRows(db);
    const { data: recent } = await db.from("live_positions").select("entry_t,exit_t,status,net_usd").gte("entry_t", new Date(Date.now() - 8 * 86400_000).toISOString());
    const [markets, st] = await Promise.all([ex.markets(), ex.state()]);
    const m = markets.get(signal.coin);
    const mark = m?.mark ?? 0;
    const now = new Date();
    const today = stockholmDay(now);
    const closed = (recent ?? []).filter((p) => p.status === "closed" && p.exit_t);
    const sumSince = (ms: number) => closed.filter((p) => Date.parse(p.exit_t) >= Date.now() - ms).reduce((a, p) => a + +(p.net_usd ?? 0), 0);
    const equity = liveEquityUsd(cfg, st.accountValue);
    const block = liveEntryBlock({
      cfg, now, coin: signal.coin, side, mark, ref_px: +signal.ref_px, stop_px: +signal.stop_px, day_volume_usd: m?.dayNtlVlm ?? null,
      open_live: act.length,
      entries_today: (recent ?? []).filter((p) => ["opening", "open", "closing", "closed"].includes(p.status) && stockholmDay(new Date(p.entry_t)) === today).length,
      day_pnl_usd: sumSince(86400_000), week_pnl_usd: sumSince(7 * 86400_000), equity_usd: equity,
    });
    if (block) return await done({ status: "skipped", note: block });
    if (!m || m.isDelisted) return await done({ status: "skipped", note: `${signal.coin} is not tradable on ${ex.network}` });
    if (act.some((p) => p.coin === signal.coin) || st.positions.some((p) => p.coin === signal.coin && p.szi !== 0))
      return await done({ status: "skipped", note: `already holding ${signal.coin}` });
    const used = act.reduce((a, p) => a + +(p.notional_usd ?? 0) / Math.max(1, +(p.leverage ?? 1)), 0);
    const z = sizeLive({ cfg, asset: m, side, mark, stop: +signal.stop_px, equityUsd: equity, usedMarginUsd: used });
    if (!z.ok) return await done({ status: "skipped", note: z.reason });
    const entry = entryOrder(m, z);
    const preview = protectiveOrders(m, side, z.sizeNum, +z.limitPx, +signal.stop_px, cfg.min_order_usd);
    const orders = [entry, preview.sl, ...(preview.t1 ? [preview.t1] : []), preview.t2];

    if (ex.dryRun) {
      for (const o of orders) await recordOrder(db, ex, null, o, { status: "dry_run" });
      return await done({ status: "dry_run", note: `would ${z.isBuy ? "buy" : "sell"} ${z.size} ${m.coin} @ ≤${z.limitPx} ($${z.notionalUsd.toFixed(2)}, risk $${z.riskUsd.toFixed(2)}, ${z.leverage}x isolated)`, orders });
    }

    const { data: pos, error: insErr } = await db.from("live_positions").insert({
      signal_id: signal.id, paper_position_id: opts.paperPositionId ?? null, network: ex.network, coin: m.coin, side, setup: signal.setup,
      status: "opening", init_stop_px: +signal.stop_px, stop_px: +signal.stop_px, leverage: z.leverage, notional_usd: z.notionalUsd,
      risk_usd: z.riskUsd, usd_sek_at_entry: cfg.usd_sek, note: `IOC ${z.size} @ ≤${z.limitPx}`,
    }).select("*").single();
    if (insErr || !pos) return await done({ status: "skipped", note: `could not reserve the position: ${insErr?.message}` });

    const lev = await ex.setLeverage(m.asset, z.leverage);
    if (!lev.ok) {
      await updatePos(db, pos.id, { status: "error", note: `leverage: ${lev.error}` });
      return await done({ status: "error", note: `could not set ${z.leverage}x isolated: ${lev.error}` });
    }
    const cloid = newCloid();
    const res = await ex.place(entry, cloid);
    await recordOrder(db, ex, pos.id, entry, res, cloid);
    let filledSz = 0;
    let fillPx = 0;
    if (res.status === "filled") { filledSz = res.totalSz; fillPx = res.avgPx; }
    else if (res.status === "unknown") {
      // The order may still land: keep the row "opening" so reconcile adopts it (with a stop) or clears it.
      await sleep(2000);
      const p2 = await ex.state().then((s) => s.positions.find((p) => p.coin === m.coin && Math.sign(p.szi) === (side === "long" ? 1 : -1))).catch(() => undefined);
      if (!p2) {
        await updatePos(db, pos.id, { note: `entry outcome unknown: ${res.error}` });
        return await done({ status: "pending", note: `entry outcome unknown (${res.error}); reconcile adopts or clears it` });
      }
      filledSz = Math.abs(p2.szi);
      fillPx = p2.entryPx;
    } else if (res.status === "resting") {
      await ex.cancel(m.asset, res.oid);
    }
    if (!(filledSz > 0)) {
      await updatePos(db, pos.id, { status: "missed", note: "error" in res ? res.error : "IOC did not fill" });
      return await done({ status: "missed", note: `IOC entry did not fill (${"error" in res ? res.error : res.status})` });
    }
    const pr = await protect(db, ex, m, pos, side, filledSz, fillPx, +signal.stop_px, cfg.min_order_usd);
    if (!pr.ok) return await done({ status: "error", note: "stop could not be placed; closing the position" });
    const riskUsd = filledSz * Math.abs(fillPx - +signal.stop_px);
    await updatePos(db, pos.id, {
      status: "open", entry_t: new Date().toISOString(), entry_px: fillPx, size: filledSz, init_size: filledSz, notional_usd: filledSz * fillPx,
      risk_usd: riskUsd, t1_px: pr.t1Px, t2_px: pr.t2Px, sl_oid: pr.slOid, t1_oid: pr.t1Oid, t2_oid: pr.t2Oid,
    });
    return await done({
      status: "filled",
      note: `${filledSz} ${m.coin} @ ${fillPx} ($${(filledSz * fillPx).toFixed(2)}, risk $${riskUsd.toFixed(2)} ≈ ${(riskUsd * cfg.usd_sek).toFixed(1)} SEK) · stop ${signal.stop_px} · T1 ${pr.t1Px.toPrecision(5)}${pr.t1Oid ? "" : " (break-even only)"} · T2 ${pr.t2Px.toPrecision(5)}`,
    });
  } catch (e) {
    return await done({ status: "error", note: errMsg(e) });
  } finally {
    if (locked) await release(db, owner).catch(() => undefined);
  }
}

/** Adopt an entry whose outcome was unknown (place its stop and targets), or clear it after 5 minutes. */
async function resolveOpening(db: DB, ex: LiveExchange, markets: Map<string, MarketInfo>, st: State, p: Row, minOrderUsd: number) {
  const age = Date.now() - Date.parse(p.entry_t);
  if (age < 60_000) return;
  const m = markets.get(p.coin);
  const e = st.positions.find((x) => x.coin === p.coin && x.szi !== 0);
  if (!m || !e || Math.sign(e.szi) !== (p.side === "long" ? 1 : -1)) {
    if (age > 5 * 60_000) await updatePos(db, p.id, { status: "missed", note: `${p.note ?? ""} · cleared: no position on the exchange` });
    return;
  }
  const size = Math.abs(e.szi);
  const pr = await protect(db, ex, m, p, p.side, size, e.entryPx, +p.init_stop_px, minOrderUsd);
  if (!pr.ok) return;
  await updatePos(db, p.id, {
    status: "open", entry_px: e.entryPx, size, init_size: size, notional_usd: size * e.entryPx, risk_usd: size * Math.abs(e.entryPx - +p.init_stop_px),
    t1_px: pr.t1Px, t2_px: pr.t2Px, sl_oid: pr.slOid, t1_oid: pr.t1Oid, t2_oid: pr.t2Oid, note: `${p.note ?? ""} · adopted by reconcile`,
  });
  await log(db, `${p.coin}: entry with unknown outcome found on the exchange (${size} @ ${e.entryPx}); stop and targets placed`, "WARN");
}

async function syncFills(db: DB, ex: LiveExchange, r: Row) {
  const since = Number(r.live_fills_cursor_ms ?? 0) || (r.live_armed_at ? Date.parse(r.live_armed_at) : Date.now() - 86400_000);
  const fills = await ex.fillsSince(since);
  if (!fills.length) return 0;
  const { data: poss } = await db.from("live_positions").select("id,coin,entry_t,exit_t,status").gte("entry_t", new Date(since - 15 * 86400_000).toISOString());
  const rows = fills.map((f) => {
    const match = (poss ?? [])
      .filter((p) => p.coin === f.coin && !["missed", "error"].includes(p.status) && Date.parse(p.entry_t) <= f.time + 60_000 && (!p.exit_t || Date.parse(p.exit_t) >= f.time - 60_000))
      .sort((a, b) => Date.parse(b.entry_t) - Date.parse(a.entry_t))[0];
    return {
      tid: f.tid, oid: f.oid, position_id: match?.id ?? null, coin: f.coin, side: f.side, dir: f.dir, px: f.px, sz: f.sz, fee: f.fee,
      fee_token: f.feeToken, closed_pnl: f.closedPnl, time: new Date(f.time).toISOString(), hash: f.hash, network: ex.network, raw: f.raw as never,
    };
  });
  const { error } = await db.from("live_fills").upsert(rows, { onConflict: "tid", ignoreDuplicates: true });
  if (error) throw new Error(`live_fills upsert: ${error.message}`);
  await db.from("desk_config").update({ live_fills_cursor_ms: Math.max(...fills.map((f) => f.time)) + 1 }).eq("id", 1);
  return fills.length;
}

async function finalizeClosed(db: DB, ex: LiveExchange, p: Row, usdSek: number) {
  const { data: fills } = await db.from("live_fills").select("*").eq("position_id", p.id).order("time");
  const fs = fills ?? [];
  const realized = fs.reduce((a, f) => a + +f.closed_pnl, 0);
  const fees = fs.reduce((a, f) => a + +f.fee, 0);
  const funding = await ex.fundingSince(Date.parse(p.entry_t), p.coin).catch(() => 0);
  const closing = fs.filter((f) => String(f.dir ?? "").startsWith("Close"));
  const qty = closing.reduce((a, f) => a + +f.sz, 0);
  const exitPx = qty > 0 ? closing.reduce((a, f) => a + +f.px * +f.sz, 0) / qty : null;
  const lastOid = closing.length ? Number(closing[closing.length - 1].oid) : null;
  const reason = p.close_reason
    ?? (lastOid != null && lastOid === Number(p.t2_oid) ? "t2"
      : lastOid != null && lastOid === Number(p.sl_oid) ? (p.be_moved ? "breakeven" : "stop")
        : "exchange");
  const net = realized - fees + funding;
  await updatePos(db, p.id, {
    status: "closed", exit_t: closing.length ? closing[closing.length - 1].time : new Date().toISOString(), exit_px: exitPx, close_reason: reason,
    realized_pnl_usd: realized, fees_usd: fees, funding_usd: funding, net_usd: net, usd_sek_at_exit: usdSek, size: 0,
  });
  await log(db, `LIVE CLOSED ${p.coin} ${p.side} (${reason}) @ ${exitPx?.toPrecision(6) ?? "?"} · net $${net.toFixed(2)} ≈ ${(net * usdSek).toFixed(1)} SEK`, net >= 0 ? "TRADE" : "WARN");
}

/** Carries out one planner action. Safety findings go to `trips`; failed exchange calls throw (infrastructure errors). */
async function applyAction(db: DB, ex: LiveExchange, a: Action, byId: Map<string, Row>, markets: Map<string, MarketInfo>, usdSek: number, trips: string[]) {
  if (a.t === "trip") { trips.push(a.reason); return; }
  if (a.t === "cancel_orphan") {
    const m = markets.get(a.coin);
    if (m) await ex.cancel(m.asset, a.oid);
    await log(db, `Cancelled an order APEX did not place: ${a.coin} oid ${a.oid}`, "WARN");
    return;
  }
  const p = byId.get(a.posId)!;
  const m = markets.get(p.coin);
  if (!m) { trips.push(`${p.coin} is missing from the exchange market list`); return; }
  const cancelAll = async (oids: number[]) => { for (const o of oids) await ex.cancel(m.asset, o); };
  switch (a.t) {
    case "closed":
      await cancelAll(a.cancel);
      await finalizeClosed(db, ex, p, usdSek);
      return;
    case "t1_filled":
    case "move_be": {
      const size = a.t === "t1_filled" ? a.newSize : a.size;
      const o = triggerOrder("sl", m, p.side, size, a.beStop);
      const res = await ex.place(o);
      await recordOrder(db, ex, p.id, o, res);
      if (res.status !== "resting") {
        // Keep the old stop in place (it is reduce-only, so it can never flip the position).
        if (a.t === "t1_filled") {
          await log(db, `${p.coin}: T1 filled but the break-even stop was rejected (${"error" in res ? res.error : res.status}); closing the rest`, "ERROR");
          await updatePos(db, p.id, { status: "closing", close_reason: "protect_failed", size, t1_done: true });
          const left = await closeAtMarket(db, ex, m, p.id);
          if (left === 0) await cancelAll(a.cancel);
        } else {
          await log(db, `${p.coin}: break-even stop rejected (${"error" in res ? res.error : res.status}); keeping the original stop`, "WARN");
        }
        return;
      }
      await cancelAll(a.cancel);
      await updatePos(db, p.id, { stop_px: a.beStop, sl_oid: res.oid, be_moved: true, size, ...(a.t === "t1_filled" ? { t1_done: true } : {}) });
      await log(db, `${p.coin}: ${a.t === "t1_filled" ? "T1 filled, half closed" : "price reached T1"} — stop moved to break-even ${a.beStop.toPrecision(6)}`, "TRADE");
      return;
    }
    case "restore_sl": {
      const o = triggerOrder("sl", m, p.side, a.size, a.stop);
      const res = await ex.place(o);
      await recordOrder(db, ex, p.id, o, res);
      if (res.status === "resting") {
        await updatePos(db, p.id, { sl_oid: res.oid });
        await log(db, `${p.coin}: stop order was missing — placed again at ${a.stop}`, "WARN");
      } else if (p.status !== "closing") {
        await log(db, `${p.coin}: stop missing and could not be replaced — closing`, "ERROR");
        await updatePos(db, p.id, { status: "closing", close_reason: "protect_failed" });
        p.status = "closing";
        await closeAtMarket(db, ex, m, p.id);
      }
      return;
    }
    case "close": {
      if (p.status !== "closing") await updatePos(db, p.id, { status: "closing", close_reason: a.reason });
      const left = await closeAtMarket(db, ex, m, p.id);
      if (left === 0) await cancelAll(a.cancel);
      else {
        const tries = Number(p.close_attempts ?? 0) + 1;
        await updatePos(db, p.id, { close_attempts: tries });
        if (tries >= 3) trips.push(`${p.coin}: close (${a.reason}) failed ${tries} times, ${left} still open`);
      }
      await log(db, `${p.coin}: closing (${a.reason}) — ${left === 0 ? "done" : `${left} still open`}`, left === 0 ? "TRADE" : "ERROR");
      return;
    }
  }
}

/** Cancel every open order, close every position, return to paper. Safe to call repeatedly; never throws. */
export async function killLive(db: DB, reason: string, opts: { ex?: LiveExchange | null } = {}) {
  await db.from("desk_config").update({ kill_switch: true, live_armed: false, mode: "paper", live_trip_reason: reason, updated_at: new Date().toISOString() }).eq("id", 1);
  await log(db, `KILL SWITCH: ${reason} — cancelling all orders and closing all positions`, "ERROR");
  const errors: string[] = [];
  let canceled = 0;
  let closed = 0;
  const ex = opts.ex === undefined ? liveExchange() : opts.ex;
  if (!ex) return { canceled, closed, errors: ["not configured"] };
  try {
    const markets = await ex.markets();
    const act = await activeRows(db).catch(() => [] as Row[]);
    // Close first, then cancel: the stops stay in place until each position is flat.
    const st = await ex.state();
    for (const p of st.positions.filter((x) => x.szi !== 0)) {
      try {
        const m = markets.get(p.coin);
        if (!m) { errors.push(`no market for ${p.coin}`); continue; }
        const posId = act.find((a) => a.coin === p.coin)?.id ?? null;
        const left = await closeAtMarket(db, ex, m, posId);
        if (left === 0) closed++; else errors.push(`${p.coin}: ${left} still open`);
      } catch (e) {
        errors.push(`${p.coin}: ${errMsg(e)}`);
      }
    }
    for (const o of await ex.openOrders()) {
      const m = markets.get(o.coin);
      const r = m ? await ex.cancel(m.asset, o.oid).catch((e) => ({ ok: false, error: errMsg(e) })) : { ok: false, error: "unknown market" };
      if (r.ok) canceled++; else errors.push(`cancel ${o.coin} ${o.oid}: ${"error" in r ? r.error : ""}`);
    }
    for (const a of act) await updatePos(db, a.id, { status: "closing", close_reason: "kill" }).catch(() => undefined);
  } catch (e) {
    errors.push(errMsg(e));
  }
  await log(db, `KILL done · ${closed} positions closed · ${canceled} orders cancelled${errors.length ? ` · ERRORS: ${errors.join("; ")} — retrying every 2 minutes` : ""}`, errors.length ? "ERROR" : "WARN");
  return { canceled, closed, errors };
}

/** Every 2 minutes (and from the Desk's "check now" button). */
export async function reconcileLive(db: DB, opts: { ex?: LiveExchange | null } = {}) {
  const ex = opts.ex === undefined ? liveExchange() : opts.ex;
  if (!ex) return { skipped: "not configured" };
  let r = await getCfg(db);
  let act = await activeRows(db);
  const out: Record<string, unknown> = { network: ex.network };

  if (r.kill_switch) {
    // Keep killing until the exchange is empty, even for positions APEX does not track.
    const [st0, orders0] = await Promise.all([ex.state(), ex.openOrders()]);
    if (r.live_armed || st0.positions.some((p) => p.szi !== 0) || orders0.length) {
      out.kill = await killLive(db, r.live_trip_reason ?? "kill switch set", { ex });
      r = await getCfg(db);
      act = await activeRows(db);
    }
  }
  if (!r.live_armed && !act.length) return { ...out, skipped: "not armed and nothing open" };

  const owner = `reconcile:${Date.now()}`;
  if (!(await acquire(db, owner, 120, 0))) return { ...out, skipped: "another live job is running" };
  try {
    const markets = await ex.markets();
    out.fills = await syncFills(db, ex, r);
    const opening = act.filter((x) => x.status === "opening");
    if (opening.length) {
      const st = await ex.state();
      for (const p of opening) await resolveOpening(db, ex, markets, st, p, +r.min_order_usd);
    }
    // Read the database first, then the exchange, so nothing can land in between unseen (the lease blocks executeLive).
    const rows = await activeRows(db);
    const snapshotT = Date.now();
    const [st, orders, mids] = await Promise.all([ex.state(), ex.openOrders(), ex.mids()]);
    const byId = new Map(rows.map((p) => [p.id as string, p]));

    const paperIds = rows.map((p) => p.paper_position_id).filter(Boolean);
    const paperExits: Record<string, string> = {};
    if (paperIds.length) {
      const { data: pp } = await db.from("paper_positions").select("id,status,exit_reason").in("id", paperIds);
      for (const p of rows) {
        const twin = (pp ?? []).find((x) => x.id === p.paper_position_id);
        if (twin?.status === "closed" && MIRRORED_PAPER_EXITS.includes(twin.exit_reason)) paperExits[p.id] = twin.exit_reason;
      }
    }
    const actions = planReconcile({ now: snapshotT, positions: rows.map(toLivePos), exch: st.positions, orders, mids, paperExits, feePct: +r.fee_pct });
    const trips: string[] = [];
    const errors: string[] = [];
    for (const a of actions) {
      try { await applyAction(db, ex, a, byId, markets, +(r.usd_sek ?? 0), trips); }
      catch (e) { errors.push(`${a.t}: ${errMsg(e)}`); }
    }
    out.actions = actions.map((a) => a.t);
    if (errors.length) {
      out.errors = errors;
      await log(db, `Reconcile: exchange or database errors (not counted as safety failures): ${errors.join("; ")}`, "ERROR");
    }

    // Account-level checks while armed, all measured up to the moment of the exchange snapshot.
    const unrealized = st.positions.reduce((a, p) => a + p.unrealizedPnl, 0);
    if (r.live_armed && r.live_start_equity_usd != null && r.live_armed_at) {
      const armedMs = Date.parse(r.live_armed_at);
      const [transfers, funding, { data: fs }] = await Promise.all([
        ex.transfersSince(armedMs, snapshotT), ex.fundingSince(armedMs, undefined, snapshotT),
        db.from("live_fills").select("closed_pnl,fee,time").gte("time", r.live_armed_at),
      ]);
      const values = transfers.map((t) => perpTransferUsd(t.delta, ex.account));
      if (values.some((v) => v == null)) {
        const kinds = transfers.filter((_, i) => values[i] == null).map((t) => t.delta.type);
        await log(db, `Equity check paused: unrecognised ledger entries (${Array.from(new Set(kinds)).join(", ")}). Re-arm to reset the baseline.`, "WARN");
      } else {
        const cfg = toLiveCfg(r);
        const eq = equityTrips({
          accountValueUsd: st.accountValue, startEquityUsd: +r.live_start_equity_usd,
          netTransfersUsd: (values as number[]).reduce((a, v) => a + v, 0),
          realizedUsd: (fs ?? []).filter((f) => Date.parse(f.time) <= snapshotT).reduce((a, f) => a + +f.closed_pnl - +f.fee, 0),
          fundingUsd: funding, unrealizedUsd: unrealized,
          budgetUsd: cfg.usd_sek > 0 ? cfg.budget_sek / cfg.usd_sek : 0, killDrawdownPct: cfg.kill_drawdown_pct,
        });
        await db.from("live_equity").insert({ account_value_usd: st.accountValue, withdrawable_usd: st.withdrawable, unrealized_usd: unrealized, expected_usd: eq.expectedUsd, note: "reconcile" });
        if (eq.drawdown) {
          out.kill = await killLive(db, `drawdown: ${eq.drawdown}`, { ex });
          return out;
        }
        if (eq.mismatch) trips.push(eq.mismatch);
      }
    } else {
      await db.from("live_equity").insert({ account_value_usd: st.accountValue, withdrawable_usd: st.withdrawable, unrealized_usd: unrealized, note: "reconcile (not armed)" });
    }

    if (trips.length) {
      const streak = Number(r.live_trip_streak ?? 0) + 1;
      out.trips = trips;
      if (streak >= HARD.tripStreakToKill) {
        await db.from("desk_config").update({ live_trip_streak: 0 }).eq("id", 1);
        out.kill = await killLive(db, `safety check failed ${streak} times in a row: ${trips.join("; ")}`, { ex });
      } else {
        await db.from("desk_config").update({ live_trip_streak: streak, live_trip_reason: trips.join("; ") }).eq("id", 1);
        await log(db, `Safety check failed (${streak} of ${HARD.tripStreakToKill} before the kill switch trips): ${trips.join("; ")}`, "WARN");
      }
    } else if (Number(r.live_trip_streak ?? 0) > 0) {
      await db.from("desk_config").update({ live_trip_streak: 0, live_trip_reason: null }).eq("id", 1);
    }
    await db.from("desk_config").update({ live_last_reconcile_at: new Date().toISOString() }).eq("id", 1);
    return out;
  } finally {
    await release(db, owner).catch(() => undefined);
  }
}

export type LiveStatus = {
  configured: boolean; missing: string[]; network: string; dryRun: boolean; account: string | null; agent: string | null;
  agentOk: boolean; agentDetail: string; agentName: string | null; agentValidUntil: number | null;
  accountValueUsd: number | null; withdrawableUsd: number | null; openExchangePositions: number; openExchangeOrders: number;
  smokePassedAt: string | null; armed: boolean; killSwitch: boolean; canArm: boolean; blockers: string[];
};

const mask = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export async function liveStatus(db: DB, opts: { ex?: LiveExchange | null } = {}): Promise<LiveStatus> {
  const env = readLiveEnv();
  const r = await getCfg(db);
  const ex = opts.ex === undefined ? liveExchange() : opts.ex;
  const base: LiveStatus = {
    configured: !!ex, missing: env.ok ? [] : env.missing, network: ex?.network ?? env.network, dryRun: ex?.dryRun ?? env.dryRun, account: null, agent: null,
    agentOk: false, agentDetail: ex ? "" : "secrets missing", agentName: null, agentValidUntil: null, accountValueUsd: null,
    withdrawableUsd: null, openExchangePositions: 0, openExchangeOrders: 0, smokePassedAt: r.smoke_test_passed_at ?? null,
    armed: !!r.live_armed, killSwitch: !!r.kill_switch, canArm: false, blockers: [],
  };
  if (!ex) { base.blockers.push(`add the secrets: ${base.missing.join(", ")}`); return base; }
  base.account = mask(ex.account);
  base.agent = mask(ex.agent);
  try {
    const [role, st, orders] = await Promise.all([ex.agentRole(), ex.state(), ex.openOrders()]);
    Object.assign(base, {
      agentOk: role.ok, agentDetail: role.detail, agentName: role.name, agentValidUntil: role.validUntil,
      accountValueUsd: st.accountValue, withdrawableUsd: st.withdrawable,
      openExchangePositions: st.positions.filter((p) => p.szi !== 0).length, openExchangeOrders: orders.length,
    });
  } catch (e) {
    base.blockers.push(`exchange not reachable: ${errMsg(e)}`);
    return base;
  }
  if (!base.agentOk) base.blockers.push(base.agentDetail);
  if ((base.accountValueUsd ?? 0) < 11) base.blockers.push("account holds less than $11");
  const smokeAge = base.smokePassedAt ? Date.now() - Date.parse(base.smokePassedAt) : Infinity;
  if (smokeAge > 7 * 86400_000) base.blockers.push("run the smoke test (must have passed in the last 7 days)");
  if (base.killSwitch) base.blockers.push("kill switch is on — turn it off first");
  if (base.openExchangePositions || base.openExchangeOrders) base.blockers.push("the account already has open positions or orders");
  if (!(+(r.usd_sek ?? 0) > 0)) base.blockers.push("no USD/SEK rate yet");
  base.canArm = !base.armed && base.blockers.length === 0;
  return base;
}

/** Open ~$11 of BTC, protect it, close it. Proves the key, signing, fills and reconcile all work. */
export async function smokeTest(db: DB, opts: { ex?: LiveExchange | null } = {}) {
  const ex = opts.ex === undefined ? liveExchange() : opts.ex;
  if (!ex) return { passed: false, steps: ["not configured: secrets missing"] };
  const r = await getCfg(db);
  const steps: string[] = [];
  const finish = async (passed: boolean, extra: Row = {}) => {
    const result = { passed, steps, network: ex.network, at: new Date().toISOString(), ...extra };
    await db.from("desk_config").update({ smoke_test_result: result as never, ...(passed ? { smoke_test_passed_at: result.at } : {}) }).eq("id", 1);
    await log(db, `SMOKE TEST ${passed ? "PASSED" : "FAILED"} on ${ex.network}: ${steps.join(" → ")}`, passed ? "INFO" : "ERROR");
    return result;
  };
  if (ex.dryRun) { steps.push("HL_DRY_RUN is on; turn it off to run the smoke test"); return finish(false); }
  if (r.live_armed) { steps.push("disarm live mode first"); return finish(false); }
  const markets = await ex.markets();
  const m = markets.get("BTC");
  if (!m) { steps.push("BTC market not found"); return finish(false); }
  const st0 = await ex.state();
  if (st0.positions.some((p) => p.coin === "BTC" && p.szi !== 0)) { steps.push("a BTC position is already open"); return finish(false); }
  if (st0.withdrawable < 11.5) { steps.push(`free balance $${st0.withdrawable.toFixed(2)} is under $11.50`); return finish(false); }
  const start = Date.now() - 5000;
  const mark = (await ex.mids()).BTC || m.mark;
  let lots = Math.ceil((11 / mark) * 10 ** m.szDecimals);
  while ((lots / 10 ** m.szDecimals) * mark < 10.6) lots++;
  const size = lots / 10 ** m.szDecimals;
  const lev = await ex.setLeverage(m.asset, 1);
  if (!lev.ok) { steps.push(`set 1x isolated failed: ${lev.error}`); return finish(false); }
  steps.push("1x isolated set");
  const open: OrderSpec = { kind: "smoke_open", coin: "BTC", asset: m.asset, isBuy: true, px: formatPrice(mark * 1.003, m.szDecimals), size: String(size), reduceOnly: false, tif: "Ioc" };
  const o1 = await ex.place(open, newCloid());
  await recordOrder(db, ex, null, open, o1);
  if (o1.status !== "filled") { steps.push(`open failed: ${"error" in o1 ? o1.error : o1.status}`); return finish(false); }
  steps.push(`bought ${o1.totalSz} BTC @ ${o1.avgPx}`);
  const sl = triggerOrder("smoke_sl", m, "long", o1.totalSz, mark * 0.95);
  const o2 = await ex.place(sl);
  await recordOrder(db, ex, null, sl, o2);
  steps.push(o2.status === "resting" ? "stop placed (resting)" : `stop failed: ${"error" in o2 ? o2.error : o2.status}`);
  const left = await closeAtMarket(db, ex, m, null);
  if (left > 0) {
    steps.push(`CLOSE FAILED: ${left} BTC still open; the stop was left in place — close it on Hyperliquid or press KILL`);
    return finish(false);
  }
  steps.push("closed");
  if (o2.status === "resting") await ex.cancel(m.asset, o2.oid);
  await sleep(1500);
  const [st1, orders, fills] = await Promise.all([ex.state(), ex.openOrders(), ex.fillsSince(start)]);
  const btcLeft = st1.positions.find((p) => p.coin === "BTC")?.szi ?? 0;
  const btcOrders = orders.filter((o) => o.coin === "BTC").length;
  const btcFills = fills.filter((f) => f.coin === "BTC");
  const fees = btcFills.reduce((a, f) => a + f.fee, 0);
  const pnl = btcFills.reduce((a, f) => a + f.closedPnl, 0) - fees;
  steps.push(`${btcFills.length} fills · fees $${fees.toFixed(4)} · net $${pnl.toFixed(4)}`);
  const passed = o2.status === "resting" && btcLeft === 0 && btcOrders === 0 && btcFills.length >= 2;
  if (btcLeft !== 0) steps.push(`BTC position still open: ${btcLeft}`);
  if (btcOrders) steps.push(`${btcOrders} BTC orders still open`);
  return finish(passed, { fees, pnl });
}

export async function armLive(db: DB, phrase: string, opts: { ex?: LiveExchange | null } = {}) {
  if (phrase.trim() !== "GO LIVE") throw new Error('Type exactly "GO LIVE" to arm');
  const s = await liveStatus(db, opts);
  if (!s.canArm) throw new Error(`Cannot arm yet: ${s.blockers.join("; ") || "already armed"}`);
  const now = new Date().toISOString();
  await db.from("desk_config").update({
    mode: "live", live_armed: true, live_armed_at: now, live_start_equity_usd: s.accountValueUsd, live_trip_streak: 0, live_trip_reason: null,
    live_fills_cursor_ms: Date.now(), updated_at: now,
  }).eq("id", 1);
  await log(db, `LIVE MODE ARMED by owner on ${s.network}${s.dryRun ? " (DRY RUN)" : ""} · account $${s.accountValueUsd?.toFixed(2)}`, "WARN");
  return { armed: true, network: s.network, startEquityUsd: s.accountValueUsd };
}

export async function disarmLive(db: DB) {
  await db.from("desk_config").update({ mode: "paper", live_armed: false, updated_at: new Date().toISOString() }).eq("id", 1);
  await log(db, "Live mode disarmed by owner (open live positions keep their stops and are still managed)", "WARN");
  return { armed: false };
}
