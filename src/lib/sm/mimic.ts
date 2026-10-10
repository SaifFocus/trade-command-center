// Mimic simulator (pure): copy active Invo traders the way Invo's Mimic does, on paper, a few minutes late.
// Every open of a mirrored wallet opens a fixed $100 virtual copy at the current mark; it closes when the wallet closes.
// Separate from the paper desk (own table, no risk rules, no review) so it measures one thing: does copying them pay
// after Invo's fees and the delay?

export const MIMIC = {
  slots: 20,
  notionalUsd: 100,
  feePct: 0.0768, // per side, Hyperliquid taker + Invo builder fee (same as the via_invo backtest config)
  slipPct: 0.05,
  minTrades: 20,
  minProfitFactor: 1.2,
  activeDays: 3,
  minLiquidShare: 50,
};

export type MimicCandidate = {
  address: string; sources: string[]; score: number; trades: number | null; profit_factor: number | null;
  ret_30: number | null; ret_90: number | null; last_trade_at: number | null; liquid_share: number | null;
};

/**
 * Active, profitable Invo traders of any holding style. Wallets already mirrored stay while they qualify (so copies are
 * not cut short by churn), then traders active in the last 24 h, then by score.
 */
export function pickMimic(cands: MimicCandidate[], nowMs: number, slots = MIMIC.slots, keep: Set<string> = new Set()): string[] {
  const fresh = (c: MimicCandidate) => (c.last_trade_at != null && nowMs - c.last_trade_at <= 86400_000 ? 1 : 0);
  return cands
    .filter((c) => c.sources.includes("invo")
      && (c.trades ?? 0) >= MIMIC.minTrades
      && (c.profit_factor ?? 0) >= MIMIC.minProfitFactor
      && ((c.ret_30 ?? 0) > 0 || (c.ret_90 ?? 0) > 0)
      && c.last_trade_at != null && nowMs - c.last_trade_at <= MIMIC.activeDays * 86400_000
      && (c.liquid_share ?? 0) >= MIMIC.minLiquidShare)
    .sort((a, b) => Number(keep.has(b.address)) - Number(keep.has(a.address)) || fresh(b) - fresh(a)
      || b.score - a.score || (b.profit_factor ?? 0) - (a.profit_factor ?? 0))
    .slice(0, slots)
    .map((c) => c.address);
}

const dirOf = (side: string) => (side === "long" ? 1 : -1);

/** Entry at the mark plus slippage against us; entry fee charged up front. */
export function mimicEntry(mark: number, side: string) {
  const entry = mark * (1 + dirOf(side) * MIMIC.slipPct / 100);
  return { entry, fees: (MIMIC.notionalUsd * MIMIC.feePct) / 100 };
}

/** Exit at the mark minus slippage; returns totals including the entry fee already charged. */
export function mimicExit(t: { side: string; entry_px: number; fees_usd: number; notional_usd: number }, mark: number) {
  const d = dirOf(t.side);
  const exit = mark * (1 - d * MIMIC.slipPct / 100);
  const gross = d * ((exit - t.entry_px) / t.entry_px) * t.notional_usd;
  const fees = t.fees_usd + (t.notional_usd * (exit / t.entry_px) * MIMIC.feePct) / 100;
  const net = gross - fees;
  return { exit, fees, net, pct: (net / t.notional_usd) * 100 };
}
