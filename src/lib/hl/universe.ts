// Paper desk coin universe (pure). Base = top 20 Hyperliquid perps by 24h volume plus the always-on coins.
// Extra coins (ranks 21–40) are added only after a group backtest on them holds up; see universe.server.ts.

export const UNIVERSE = {
  baseTop: 20,
  candidateTop: 40,
  /** Group gate for the candidate coins (judged together; per-coin results are too small to select on). */
  minGroupTrades: 40,
  minProfitFactor: 1.0,
  maxDrawdownPct: 25,
  /** Per-coin exclusions: only clear problems, never "this coin did best". */
  minHistoryDays: 180,
  minVolumeUsd: 3_000_000,
  failMinTrades: 8,
  failExpectancyR: -0.5,
};

export type UniRow = { coin: string; day_ntl_vlm: number };

const byVolume = (rows: UniRow[]) => [...rows].sort((a, b) => b.day_ntl_vlm - a.day_ntl_vlm);

/** Top `n` by volume plus the always-on coins that are listed. */
export function baseCoins(rows: UniRow[], always: string[], n = UNIVERSE.baseTop): string[] {
  const listed = new Set(rows.map((r) => r.coin));
  return Array.from(new Set([...byVolume(rows).slice(0, n).map((r) => r.coin), ...always.filter((c) => listed.has(c))]));
}

/** Ranks baseTop+1..candidateTop that are not already in the base set. */
export function candidateCoins(rows: UniRow[], always: string[]): string[] {
  const base = new Set(baseCoins(rows, always));
  return byVolume(rows).slice(0, UNIVERSE.candidateTop).map((r) => r.coin).filter((c) => !base.has(c));
}

/** Coins the paper desk may signal on: base set plus validated extras. */
export function deskCoins(rows: UniRow[], always: string[], extras: string[]): string[] {
  return Array.from(new Set([...baseCoins(rows, always), ...extras]));
}

export type GroupStats = { trades: number; expectancy_in: number; expectancy_out: number; profit_factor: number; max_drawdown_pct: number };
export type CoinStats = { coin: string; trades: number; expectancy_r: number; history_days: number; day_ntl_vlm: number };
export type UniverseDecision = { pass: boolean; reasons: string[]; add: string[]; excluded: { coin: string; reason: string }[] };

export function universeDecision(group: GroupStats, coins: CoinStats[]): UniverseDecision {
  const U = UNIVERSE;
  const reasons: string[] = [];
  if (group.trades < U.minGroupTrades) reasons.push(`only ${group.trades} backtest trades (need ${U.minGroupTrades})`);
  if (!(group.expectancy_in > 0)) reasons.push(`expectancy in the first 60% is ${group.expectancy_in.toFixed(3)}R (need > 0)`);
  if (!(group.expectancy_out > 0)) reasons.push(`expectancy in the last 40% is ${group.expectancy_out.toFixed(3)}R (need > 0)`);
  if (!(group.profit_factor > U.minProfitFactor)) reasons.push(`profit factor ${group.profit_factor.toFixed(2)} (need > ${U.minProfitFactor})`);
  if (!(group.max_drawdown_pct < U.maxDrawdownPct)) reasons.push(`max drawdown ${group.max_drawdown_pct.toFixed(1)}% (need < ${U.maxDrawdownPct}%)`);
  const excluded: { coin: string; reason: string }[] = [];
  const add: string[] = [];
  for (const c of coins) {
    if (c.history_days < U.minHistoryDays) excluded.push({ coin: c.coin, reason: `${Math.round(c.history_days)} days of history` });
    else if (c.day_ntl_vlm < U.minVolumeUsd) excluded.push({ coin: c.coin, reason: `24h volume $${(c.day_ntl_vlm / 1e6).toFixed(1)}M` });
    else if (c.trades >= U.failMinTrades && c.expectancy_r <= U.failExpectancyR) excluded.push({ coin: c.coin, reason: `${c.trades} trades at ${c.expectancy_r.toFixed(2)}R each` });
    else add.push(c.coin);
  }
  const pass = reasons.length === 0;
  return { pass, reasons, add: pass ? add.sort() : [], excluded };
}
