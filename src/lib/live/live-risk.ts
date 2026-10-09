// Live execution rules for real orders on Hyperliquid. Pure (no I/O) so every rule is unit-testable.
// The I/O side (signing, sending, database) lives in hl-exchange.server.ts and live.server.ts.
import { formatPrice, formatSize } from "@nktkas/hyperliquid/utils";

export type Side = "long" | "short";

export type LiveCfg = {
  budget_sek: number;
  usd_sek: number;
  risk_pct: number;
  max_risk_pct: number;
  max_open: number;
  min_order_usd: number;
  fee_pct: number;
  slip_pct: number; // expected entry slippage, used for risk (the IOC limit allows up to entrySlipPct)
  daily_loss_pct: number;
  weekly_loss_pct: number;
  kill_drawdown_pct: number;
  night_rule: boolean;
  kill_switch: boolean;
  live_armed: boolean;
  live_whitelist: string[];
  live_setups: string[]; // setups allowed to trade real money (smart_money_follow stays paper until its backtest gate passes)
  live_min_volume_usd: number;
  max_entries_per_day: number;
};

/** Hard limits that no config row can loosen. */
export const HARD = {
  tripStreakToKill: 3, // consecutive failed safety checks (2 minutes apart) before the kill switch trips
  maxNotionalUsd: 200, // largest single position
  maxNotionalEquityMult: 2.5, // largest position as a multiple of equity
  entrySlipPct: 0.3, // IOC entry limit distance from mark
  closeSlipPct: [1, 3, 5], // IOC close limit distance from mark, widened on each retry
  triggerSlipPct: 10, // limit price on market trigger orders (Hyperliquid's own default tolerance)
  minOrderCushion: 1.02, // stay 2% above the exchange minimum order value
  mismatchPct: 5, // size or equity mismatch that counts as a safety trip
  maxMovePastRefR: 0.5, // skip if price already ran more than 0.5R toward the target
} as const;

export type AssetInfo = { coin: string; asset: number; szDecimals: number; maxLeverage: number };

export const liveLeverageCap = (coin: string) => (coin === "BTC" || coin === "ETH" ? 5 : 3);
const dirOf = (side: Side) => (side === "long" ? 1 : -1);

export function stockholmHour(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "numeric", hourCycle: "h23" }).format(d));
}
export function stockholmDay(d: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Equity the live desk sizes from: never more than the budget, never more than the account holds. */
export function liveEquityUsd(cfg: Pick<LiveCfg, "budget_sek" | "usd_sek">, accountValueUsd: number): number {
  const budgetUsd = cfg.usd_sek > 0 ? cfg.budget_sek / cfg.usd_sek : 0;
  return Math.max(0, Math.min(accountValueUsd, budgetUsd));
}

// ---------------------------------------------------------------------------------------------
// Entry checks
// ---------------------------------------------------------------------------------------------

export type EntryCheckInput = {
  cfg: LiveCfg;
  now: Date;
  coin: string;
  side: Side;
  setup: string;
  mark: number;
  ref_px: number;
  stop_px: number;
  day_volume_usd: number | null;
  open_live: number;
  entries_today: number;
  day_pnl_usd: number;
  week_pnl_usd: number;
  equity_usd: number;
};

/** Returns the reason an entry is not allowed, or null when every rule passes. */
export function liveEntryBlock(x: EntryCheckInput): string | null {
  const { cfg } = x;
  if (cfg.kill_switch) return "kill switch is on";
  if (!cfg.live_armed) return "live mode is not armed";
  if (!(cfg.usd_sek > 0)) return "no USD/SEK rate";
  if (!cfg.live_setups.includes(x.setup)) return `setup ${x.setup} is paper-only (not in live_setups)`;
  if (cfg.night_rule && stockholmHour(x.now) < 7) return "night rule: no new entries 00:00-07:00 Stockholm";
  const listed = cfg.live_whitelist.includes(x.coin);
  if (!listed && !((x.day_volume_usd ?? 0) >= cfg.live_min_volume_usd))
    return `${x.coin} is not on the live list and trades under $${Math.round(cfg.live_min_volume_usd / 1e6)}M a day`;
  if (x.open_live >= cfg.max_open) return `max open live positions (${cfg.max_open}) reached`;
  if (x.entries_today >= cfg.max_entries_per_day) return `max ${cfg.max_entries_per_day} live entries today reached`;
  if (!(x.equity_usd > 0)) return "no equity on the exchange account";
  if (-x.day_pnl_usd >= (x.equity_usd * cfg.daily_loss_pct) / 100) return `daily loss limit ${cfg.daily_loss_pct}% reached`;
  if (-x.week_pnl_usd >= (x.equity_usd * cfg.weekly_loss_pct) / 100) return `weekly loss limit ${cfg.weekly_loss_pct}% reached`;
  const dir = dirOf(x.side);
  if (!(x.mark > 0)) return "no mark price";
  if (dir * (x.mark - x.stop_px) <= 0) return "price is already beyond the stop";
  const sigR = Math.abs(x.ref_px - x.stop_px);
  if (dir * (x.mark - x.ref_px) > HARD.maxMovePastRefR * sigR) return "price moved more than 0.5R toward the target";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Sizing
// ---------------------------------------------------------------------------------------------

export type LiveSize =
  | {
      ok: true;
      isBuy: boolean;
      limitPx: string; // IOC limit, formatted to tick rules
      size: string; // formatted to lot size
      sizeNum: number;
      notionalUsd: number; // at mark
      riskUsd: number; // to the stop, from the expected fill
      leverage: number;
      marginUsd: number;
    }
  | { ok: false; reason: string };

/** Size in whole lots (10^-szDecimals) as an integer count, avoiding float drift. */
function lotsFor(sizeCoin: number, szDecimals: number) {
  return Math.floor(sizeCoin * 10 ** szDecimals + 1e-9);
}
const lotsToSize = (lots: number, szDecimals: number) => lots / 10 ** szDecimals;

export function sizeLive(p: {
  cfg: LiveCfg;
  asset: AssetInfo;
  side: Side;
  mark: number;
  stop: number;
  equityUsd: number;
  usedMarginUsd: number;
}): LiveSize {
  const { cfg, asset, side, mark, stop, equityUsd } = p;
  const dir = dirOf(side);
  if (!(mark > 0) || !(stop > 0)) return { ok: false, reason: "bad price input" };
  if (dir * (mark - stop) <= 0) return { ok: false, reason: "price is beyond the stop" };
  if (!(equityUsd > 0)) return { ok: false, reason: "no equity" };

  const limit = mark * (1 + (dir * HARD.entrySlipPct) / 100);
  const expected = mark * (1 + (dir * cfg.slip_pct) / 100);
  const stopDist = Math.abs(expected - stop) / expected; // risk measured from the expected fill, as on the paper desk
  const minNotional = cfg.min_order_usd * HARD.minOrderCushion;
  const cap = Math.min(HARD.maxNotionalUsd, HARD.maxNotionalEquityMult * equityUsd);
  if (minNotional > cap) return { ok: false, reason: `minimum order $${minNotional.toFixed(2)} is above the cap $${cap.toFixed(2)}` };

  let notional = ((equityUsd * cfg.risk_pct) / 100) / stopDist;
  notional = Math.min(Math.max(notional, minNotional), cap);

  let lots = lotsFor(notional / mark, asset.szDecimals);
  for (let i = 0; i < 1000 && lotsToSize(lots, asset.szDecimals) * mark < minNotional; i++) lots++;
  while (lots > 0 && lotsToSize(lots, asset.szDecimals) * mark > cap) lots--;
  const sizeNum = lotsToSize(lots, asset.szDecimals);
  if (!(sizeNum > 0) || sizeNum * mark < cfg.min_order_usd)
    return { ok: false, reason: "no size fits between the minimum order and the cap" };

  const notionalUsd = sizeNum * mark;
  const riskUsd = notionalUsd * stopDist;
  const maxRisk = (equityUsd * cfg.max_risk_pct) / 100;
  if (riskUsd > maxRisk + 1e-9)
    return { ok: false, reason: `smallest allowed order risks ${((riskUsd / equityUsd) * 100).toFixed(2)}% > max ${cfg.max_risk_pct}%` };

  const leverage = Math.max(1, Math.min(liveLeverageCap(asset.coin), asset.maxLeverage));
  const marginUsd = notionalUsd / leverage;
  const free = equityUsd - p.usedMarginUsd;
  if (marginUsd > free) return { ok: false, reason: `margin $${marginUsd.toFixed(2)} exceeds free equity $${free.toFixed(2)}` };

  return {
    ok: true,
    isBuy: side === "long",
    limitPx: formatPrice(limit, asset.szDecimals),
    size: formatSize(sizeNum, asset.szDecimals),
    sizeNum,
    notionalUsd,
    riskUsd,
    leverage,
    marginUsd,
  };
}

// ---------------------------------------------------------------------------------------------
// Protective orders
// ---------------------------------------------------------------------------------------------

export type OrderSpec = {
  kind: "entry" | "sl" | "t1" | "t2" | "close" | "smoke_open" | "smoke_sl" | "smoke_close";
  coin: string;
  asset: number;
  isBuy: boolean;
  px: string;
  size: string;
  reduceOnly: boolean;
  tif?: "Ioc" | "Gtc";
  trigger?: { triggerPx: string; tpsl: "tp" | "sl"; isMarket: true };
};

export function targetsFrom(side: Side, entryPx: number, stopPx: number) {
  const dir = dirOf(side);
  const R = Math.abs(entryPx - stopPx);
  return { R, t1: entryPx + dir * 1.5 * R, t2: entryPx + dir * 3 * R };
}

/** A reduce-only market trigger that closes `size` of a `side` position at `triggerPx`. */
export function triggerOrder(kind: "sl" | "t1" | "t2" | "smoke_sl", a: AssetInfo, side: Side, size: number, triggerPx: number): OrderSpec {
  const closeIsBuy = side === "short";
  const slip = HARD.triggerSlipPct / 100;
  const limit = closeIsBuy ? triggerPx * (1 + slip) : triggerPx * (1 - slip);
  return {
    kind,
    coin: a.coin,
    asset: a.asset,
    isBuy: closeIsBuy,
    px: formatPrice(limit, a.szDecimals),
    size: formatSize(size, a.szDecimals),
    reduceOnly: true,
    trigger: { triggerPx: formatPrice(triggerPx, a.szDecimals), tpsl: kind === "t1" || kind === "t2" ? "tp" : "sl", isMarket: true },
  };
}

/** Reduce-only IOC close at mark ± slippage (attempt 0, 1, 2 widen the price). */
export function closeOrder(a: AssetInfo, side: Side, size: number, mark: number, attempt = 0, kind: OrderSpec["kind"] = "close"): OrderSpec {
  const closeIsBuy = side === "short";
  const pct = HARD.closeSlipPct[Math.min(attempt, HARD.closeSlipPct.length - 1)] / 100;
  const px = closeIsBuy ? mark * (1 + pct) : mark * (1 - pct);
  return { kind, coin: a.coin, asset: a.asset, isBuy: closeIsBuy, px: formatPrice(px, a.szDecimals), size: formatSize(size, a.szDecimals), reduceOnly: true, tif: "Ioc" };
}

export function entryOrder(a: AssetInfo, z: Extract<LiveSize, { ok: true }>): OrderSpec {
  return { kind: "entry", coin: a.coin, asset: a.asset, isBuy: z.isBuy, px: z.limitPx, size: z.size, reduceOnly: false, tif: "Ioc" };
}

/**
 * Stop for the full size, T1 for half, T2 for the rest.
 * Hyperliquid's $10 minimum applies to every order except a reduce-only order that closes the WHOLE position,
 * so the split is used only when both halves are worth at least the minimum at their trigger prices.
 * Otherwise there is no T1 order: T2 takes the full size and reconcile moves the stop to break-even at T1.
 */
export function protectiveOrders(a: AssetInfo, side: Side, filledSize: number, entryPx: number, stopPx: number, minOrderUsd = 10) {
  const { t1, t2 } = targetsFrom(side, entryPx, stopPx);
  const totalLots = lotsFor(filledSize, a.szDecimals);
  const halfLots = Math.floor(totalLots / 2);
  const restLots = totalLots - halfLots;
  const min = minOrderUsd * HARD.minOrderCushion;
  const split = halfLots > 0 && lotsToSize(halfLots, a.szDecimals) * t1 >= min && lotsToSize(restLots, a.szDecimals) * t2 >= min;
  const sl = triggerOrder("sl", a, side, lotsToSize(totalLots, a.szDecimals), stopPx);
  const t1o = split ? triggerOrder("t1", a, side, lotsToSize(halfLots, a.szDecimals), t1) : null;
  const t2o = triggerOrder("t2", a, side, lotsToSize(split ? restLots : totalLots, a.szDecimals), t2);
  return { sl, t1: t1o, t2: t2o, t1Px: t1, t2Px: t2, split };
}

/** Break-even stop that also covers the round-trip taker fee on what is left. */
export function breakEvenStop(side: Side, entryPx: number, feePct: number) {
  return entryPx * (1 + (dirOf(side) * 2 * feePct) / 100);
}

// ---------------------------------------------------------------------------------------------
// Account-level safety trips
// ---------------------------------------------------------------------------------------------

export type EquityTripInput = {
  accountValueUsd: number;
  startEquityUsd: number; // account value when armed
  netTransfersUsd: number; // deposits − withdrawals (and spot↔perp moves) since arming
  realizedUsd: number; // Σ closedPnl − fees since arming
  fundingUsd: number; // Σ funding since arming (negative when paid)
  unrealizedUsd: number; // open positions now
  budgetUsd: number;
  killDrawdownPct: number;
};

export function equityTrips(x: EquityTripInput): { drawdown: string | null; mismatch: string | null; lossUsd: number; expectedUsd: number } {
  const basis = Math.max(0.01, Math.min(x.startEquityUsd, x.budgetUsd));
  const lossUsd = x.startEquityUsd + x.netTransfersUsd - x.accountValueUsd;
  const expectedUsd = x.startEquityUsd + x.netTransfersUsd + x.realizedUsd + x.fundingUsd + x.unrealizedUsd;
  const drawdown =
    lossUsd >= (x.killDrawdownPct / 100) * basis
      ? `loss since arming $${lossUsd.toFixed(2)} ≥ ${x.killDrawdownPct}% of $${basis.toFixed(2)}`
      : null;
  const diff = x.accountValueUsd - expectedUsd;
  const mismatch =
    Math.abs(diff) > (HARD.mismatchPct / 100) * basis
      ? `account value $${x.accountValueUsd.toFixed(2)} differs from expected $${expectedUsd.toFixed(2)} by $${diff.toFixed(2)}`
      : null;
  return { drawdown, mismatch, lossUsd, expectedUsd };
}

// ---------------------------------------------------------------------------------------------
// Reconcile planner: compares APEX's records with the exchange and decides what to do.
// ---------------------------------------------------------------------------------------------

export type LivePos = {
  id: string;
  coin: string;
  side: Side;
  setup: string;
  status: "opening" | "open" | "closing";
  entry_t: string;
  entry_px: number;
  size: number; // size APEX believes is open now
  stop_px: number;
  t1_px: number;
  t2_px: number;
  be_moved: boolean;
  t1_done: boolean;
  sl_oid: number | null;
  t1_oid: number | null;
  t2_oid: number | null;
  close_reason: string | null;
};
export type ExchPos = { coin: string; szi: number; entryPx: number; unrealizedPnl: number };
export type ExchOrder = { oid: number; coin: string; isTrigger: boolean; reduceOnly: boolean; sz: number; triggerPx: number; side: "B" | "A" };

export type Action =
  | { t: "closed"; posId: string; cancel: number[] }
  | { t: "t1_filled"; posId: string; newSize: number; beStop: number; cancel: number[] }
  | { t: "move_be"; posId: string; beStop: number; size: number; cancel: number[] }
  | { t: "restore_sl"; posId: string; stop: number; size: number }
  | { t: "close"; posId: string; reason: string; size: number; cancel: number[] }
  | { t: "cancel_orphan"; oid: number; coin: string }
  | { t: "trip"; reason: string };

export type ReconcileInput = {
  now: number;
  positions: LivePos[];
  exch: ExchPos[];
  orders: ExchOrder[];
  mids: Record<string, number>;
  paperExits: Record<string, string>; // live position id → exit reason of its paper twin (time / max_hold / follow_exit)
  feePct: number;
};

/** Backstop only: the paper twin's own time stop (42 bars technical) is mirrored through paperExits. */
export const maxHoldMs = (_setup: string) => 14 * 86400_000; // 84 four-hour bars

export function planReconcile(x: ReconcileInput): Action[] {
  const out: Action[] = [];
  const resting = new Map(x.orders.map((o) => [o.oid, o]));
  const exchBy = new Map(x.exch.filter((e) => e.szi !== 0).map((e) => [e.coin, e]));
  const knownCoins = new Set(x.positions.map((p) => p.coin));
  const inflightCoins = new Set(x.positions.filter((p) => p.status === "opening").map((p) => p.coin));
  const ownOids = new Set<number>();
  const tol = HARD.mismatchPct / 100;

  for (const p of x.positions) {
    for (const oid of [p.sl_oid, p.t1_oid, p.t2_oid]) if (oid != null) ownOids.add(oid);
    if (p.status === "opening") continue; // an entry is in flight; executeLive finishes it
    const oids = [p.sl_oid, p.t1_oid, p.t2_oid].filter((o): o is number => o != null && resting.has(o));
    const e = exchBy.get(p.coin);
    if (!e) {
      out.push({ t: "closed", posId: p.id, cancel: oids });
      continue;
    }
    const dir = p.side === "long" ? 1 : -1;
    if (p.status === "closing") {
      // A close that has not finished: keep a stop on it and try the close again every run.
      const exSz = Math.abs(e.szi);
      if (p.sl_oid == null || !resting.has(p.sl_oid)) {
        const anyStop = x.orders.some((o) => o.coin === p.coin && o.isTrigger && o.reduceOnly);
        if (!anyStop) out.push({ t: "restore_sl", posId: p.id, stop: p.stop_px, size: exSz });
      }
      out.push({ t: "close", posId: p.id, reason: p.close_reason ?? "retry", size: exSz, cancel: [] });
      continue;
    }
    if (Math.sign(e.szi) !== dir) {
      out.push({ t: "trip", reason: `${p.coin}: exchange holds a ${e.szi > 0 ? "long" : "short"}, APEX expects ${p.side}` });
      continue;
    }
    const exSize = Math.abs(e.szi);
    const mark = x.mids[p.coin];
    if (exSize > p.size * (1 + tol)) {
      out.push({ t: "trip", reason: `${p.coin}: exchange size ${exSize} is larger than APEX's ${p.size}` });
      continue;
    }
    let slHandled = false;
    if (exSize < p.size * (1 - tol)) {
      const t1Gone = p.t1_oid != null && !resting.has(p.t1_oid);
      if (t1Gone && !p.t1_done) {
        out.push({
          t: "t1_filled",
          posId: p.id,
          newSize: exSize,
          beStop: breakEvenStop(p.side, p.entry_px, x.feePct),
          cancel: p.sl_oid != null && resting.has(p.sl_oid) ? [p.sl_oid] : [],
        });
        slHandled = true;
      } else {
        out.push({ t: "trip", reason: `${p.coin}: exchange size ${exSize} is smaller than APEX's ${p.size} with no target filled` });
        continue;
      }
    }
    if (!slHandled && (p.sl_oid == null || !resting.has(p.sl_oid))) {
      out.push({ t: "restore_sl", posId: p.id, stop: p.stop_px, size: exSize });
      slHandled = true;
    }
    // No T1 order resting from the start (half was below the minimum): move to break-even by price.
    if (!slHandled && p.t1_oid == null && !p.be_moved && mark > 0 && dir * (mark - p.t1_px) >= 0) {
      out.push({
        t: "move_be",
        posId: p.id,
        beStop: breakEvenStop(p.side, p.entry_px, x.feePct),
        size: exSize,
        cancel: p.sl_oid != null && resting.has(p.sl_oid) ? [p.sl_oid] : [],
      });
    }
    const t2Resting = p.t2_oid != null && resting.has(p.t2_oid);
    const closeReason =
      !t2Resting && mark > 0 && dir * (mark - p.t2_px) >= 0
        ? "t2_no_order"
        : x.paperExits[p.id]
          ? x.paperExits[p.id]
          : x.now - Date.parse(p.entry_t) >= maxHoldMs(p.setup)
            ? "max_hold"
            : null;
    if (closeReason) out.push({ t: "close", posId: p.id, reason: closeReason, size: exSize, cancel: oids });
  }

  for (const e of exchBy.values())
    if (!knownCoins.has(e.coin)) out.push({ t: "trip", reason: `unknown ${e.szi > 0 ? "long" : "short"} position on ${e.coin} (${e.szi})` });

  // Orders APEX did not place are cancelled, except reduce-only orders on a coin that still has a position:
  // those may be the only thing protecting it.
  for (const o of x.orders)
    if (!ownOids.has(o.oid) && !inflightCoins.has(o.coin) && !(o.reduceOnly && exchBy.has(o.coin)))
      out.push({ t: "cancel_orphan", oid: o.oid, coin: o.coin });

  return out;
}

/**
 * Ledger deltas that move USDC into (+) or out of (−) the main perp account.
 * Returns null for kinds it cannot value, so the caller holds the equity check instead of guessing.
 */
export function perpTransferUsd(delta: { type: string; [k: string]: unknown }, user: string): number | null {
  const u = user.toLowerCase();
  const num = (v: unknown) => (v == null ? 0 : Number(v)) || 0;
  const isMe = (v: unknown) => String(v ?? "").toLowerCase() === u;
  switch (delta.type) {
    case "deposit":
      return num(delta.usdc);
    case "withdraw":
      return -(num(delta.usdc) + num(delta.fee));
    case "accountClassTransfer":
      return delta.toPerp ? num(delta.usdc) : -num(delta.usdc);
    case "internalTransfer":
    case "subAccountTransfer": {
      const amt = num(delta.usdc);
      if (isMe(delta.destination) && !isMe(delta.user)) return amt;
      if (isMe(delta.user) && !isMe(delta.destination)) return -(amt + num(delta.fee));
      return 0;
    }
    case "send": {
      // sendAsset / agentSendAsset: "" is the main USDC perp dex, "spot" is spot, anything else another perp dex.
      const v = num(delta.usdcValue);
      let d = 0;
      if (isMe(delta.user) && delta.sourceDex === "") d -= v + num(delta.fee);
      if (isMe(delta.destination) && delta.destinationDex === "") d += v;
      return d;
    }
    case "vaultDeposit":
      return -num(delta.usdc);
    case "vaultWithdraw":
      return num(delta.netWithdrawnUsd);
    case "liquidation": // a trading loss, already in the account value and the fills
    case "spotTransfer":
    case "spotGenesis":
    case "rewardsClaim":
    case "cStakingTransfer":
    case "activateDexAbstraction":
    case "deployGasAuction":
      return 0;
    default:
      return null;
  }
}

/** Random 16-byte client order id (0x + 32 hex). */
export function newCloid(): `0x${string}` {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return `0x${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}`;
}
