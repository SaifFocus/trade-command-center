// FX paper desk: pure rules (sizing, isolated liquidation price, 1-minute bar walk). No I/O.
// The SQL functions fx_open / fx__close (migration fx_paper_desk) use the same formulas; change both together.

export const FX_COINS = ["xyz:EUR", "xyz:JPY", "xyz:GBP", "xyz:GOLD", "xyz:SILVER"] as const;
export const MIN_NOTIONAL_USD = 10;

const METALS = new Set(["xyz:GOLD", "xyz:SILVER"]);
/** Maintenance margin rate (fraction). */
export const maintRate = (coin: string) => (METALS.has(coin) ? 0.025 : 0.01);
export const coinMaxLev = (coin: string) => (METALS.has(coin) ? 20 : 50);
/** Slippage in percent: the book's rate, at least 0.05% on thin xyz:GBP. */
export const slipFor = (coin: string, slipPct: number) => (coin === "xyz:GBP" ? Math.max(slipPct, 0.05) : slipPct);

export type Side = "long" | "short";
export const dirOf = (s: Side | string) => (s === "long" ? 1 : -1);

export interface SizeInput {
  equity: number;
  /** Margin not used by other open positions in the book. */
  freeMargin: number;
  entry: number;
  stop: number;
  riskPct: number;
  maxRiskPct: number;
  leverage: number;
  maxLeverage: number;
  coin: string;
}
export type SizeResult =
  | { ok: true; riskUsd: number; size: number; notional: number; leverage: number; margin: number; capped: boolean }
  | { ok: false; error: string; notional: number };

/** risk = equity × min(risk%, max risk%); size = risk / |entry − stop|; notional capped at free margin × leverage. */
export function sizePosition(i: SizeInput): SizeResult {
  const lev = Math.min(i.leverage, i.maxLeverage, coinMaxLev(i.coin));
  const dist = Math.abs(i.entry - i.stop);
  let riskUsd = (i.equity * Math.min(i.riskPct, i.maxRiskPct)) / 100;
  let size = riskUsd / dist;
  let notional = size * i.entry;
  const cap = Math.max(Math.min(i.equity, i.freeMargin), 0) * lev;
  let capped = false;
  if (notional > cap) {
    notional = cap;
    size = cap / i.entry;
    riskUsd = size * dist;
    capped = true;
  }
  if (!(notional >= MIN_NOTIONAL_USD)) return { ok: false, error: "below $10 minimum", notional };
  return { ok: true, riskUsd, size, notional, leverage: lev, margin: notional / lev, capped };
}

/** Isolated liquidation price: margin + PnL at liq = maintenance rate × size × liq. */
export function liqPrice(side: Side, entry: number, size: number, margin: number, mmr: number): number {
  return side === "long"
    ? Math.max((entry * size - margin) / (size * (1 - mmr)), 0)
    : (entry * size + margin) / (size * (1 + mmr));
}

export interface Bar { t: number; o: number; h: number; l: number; c: number }
export interface WalkPos { side: Side; size: number; notional: number; stop: number; target: number | null; liq: number }
export interface WalkResult {
  exit: { px: number; reason: "liquidation" | "stop" | "target"; t: number } | null;
  /** Funding paid (positive) or received (negative) over the walked bars. */
  funding: number;
  /** End of the last bar walked (ms), or null if none. */
  checkedTo: number | null;
}

const HOUR = 3_600_000;

/** Walks 1-minute bars in order. Funding is charged on each bar that starts on the hour (longs pay positive rates).
 * Per bar: liquidation first, then stop (gap → bar open), then target; stop wins over target in the same bar.
 * Stop/target fills get slippage against us; liquidation fills at liq_px. */
export function walkBars(p: WalkPos, bars: Bar[], fundingRate: number, slipPct: number): WalkResult {
  const d = dirOf(p.side);
  const s = slipPct / 100;
  const slip = (px: number) => px * (1 - d * s);
  let funding = 0;
  let checkedTo: number | null = null;
  for (const b of [...bars].sort((a, c) => a.t - c.t)) {
    if (b.t % HOUR === 0) funding += d * p.notional * fundingRate;
    checkedTo = b.t + 60_000;
    const liqHit = d === 1 ? b.l <= p.liq : b.h >= p.liq;
    if (liqHit) return { exit: { px: p.liq, reason: "liquidation", t: b.t }, funding, checkedTo };
    const stopHit = d === 1 ? b.l <= p.stop : b.h >= p.stop;
    if (stopHit) {
      const gapped = d === 1 ? b.o <= p.stop : b.o >= p.stop;
      return { exit: { px: slip(gapped ? b.o : p.stop), reason: "stop", t: b.t }, funding, checkedTo };
    }
    if (p.target != null && (d === 1 ? b.h >= p.target : b.l <= p.target)) {
      return { exit: { px: slip(p.target), reason: "target", t: b.t }, funding, checkedTo };
    }
  }
  return { exit: null, funding, checkedTo };
}

/** Unrealized P&L at mid, capped at the margin (isolated). */
export function unrealized(side: Side | string, entry: number, mid: number, size: number, funding: number, margin: number) {
  return Math.max(dirOf(side) * (mid - entry) * size - funding, -margin);
}
