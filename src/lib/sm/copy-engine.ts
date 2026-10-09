// Walk-forward copy backtest. Pure (no I/O). Results in R-multiples, same trade management as the paper desk.
// For each month M after the first 90 days of history: grade every wallet using ONLY data before M, pick the top
// eligible wallets, and simulate following their opens during M with a 1-hour delay and real costs.
import { atr, lastClosedDay, stepPosition, stats, type Bar, type BtTrade, type PosState } from "@/lib/hl/engine";
import { computeMetrics, type Portfolio, type SmTrade } from "./positions";
import { scoreWallet } from "./score";

const H1 = 3600_000;
const DAY = 86400_000;

export type CopyWallet = { address: string; sources: string[]; trades: SmTrade[]; portfolio: Portfolio; firstSeen?: number };
export type CoinHourly = { coin: string; c1h: Bar[]; c1d: Bar[]; f1h: Map<number, number> };
export type CopyParams = {
  delayMin: number; maxMoveR: number; atrMult: number; maxHoldDays: number; feePct: number; slipPct: number;
  topN: number; consensusHours: number; maxConcurrent: number; riskPct: number;
};
export const DEFAULT_COPY_PARAMS: CopyParams = {
  delayMin: 60, maxMoveR: 0.5, atrMult: 1.5, maxHoldDays: 14, feePct: 0.045, slipPct: 0.05,
  topN: 30, consensusHours: 12, maxConcurrent: 2, riskPct: 0.015,
};

export type CopyVariant = "tier_a" | "consensus";
export type CopySignal = {
  variant: CopyVariant; coin: string; side: "long" | "short"; t: number; theirEntryPx: number; theirExitT: number;
  wallets: string[]; source: "invo" | "leaderboard" | "both";
};
export type CopyTrade = BtTrade & { variant: CopyVariant; source: CopySignal["source"]; wallets: string[]; month: string };

const monthKey = (t: number) => new Date(t).toISOString().slice(0, 7);
const sourceOf = (ws: CopyWallet[]): CopySignal["source"] => {
  const inv = ws.some((w) => w.sources.includes("invo")), lb = ws.some((w) => w.sources.includes("leaderboard"));
  return inv && lb ? "both" : inv ? "invo" : "leaderboard";
};

/** Month starts (UTC) from 90 days after the first data point up to `end`. */
export function walkForwardMonths(dataStart: number, end: number): number[] {
  const first = new Date(dataStart + 90 * DAY);
  let m = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
  const out: number[] = [];
  while (m < end) { out.push(m); const d = new Date(m); m = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); }
  return out;
}

/** Point-in-time grades as of `asOf` (only trades closed and portfolio points before it). */
export function gradeAt(wallets: CopyWallet[], asOf: number, liquid: Set<string>) {
  return wallets.map((w) => {
    const trades = w.trades.filter((t) => t.entry_t < asOf);
    const portfolio: Portfolio = { av: w.portfolio.av.filter(([t]) => t < asOf), pnl: w.portfolio.pnl.filter(([t]) => t < asOf) };
    const m = computeMetrics(trades, portfolio, asOf, liquid, w.firstSeen);
    return { wallet: w, score: scoreWallet(m, asOf) };
  });
}

/** Signals for month [m0, m1): tier A opens, and consensus of >= 2 watchlist wallets on the same coin and side within 12 h. */
export function monthSignals(wallets: CopyWallet[], m0: number, m1: number, liquid: Set<string>, p: CopyParams): CopySignal[] {
  const graded = gradeAt(wallets, m0, liquid);
  const eligible = graded.filter((g) => g.score.eligible && (g.score.tier === "A" || g.score.tier === "B"))
    .sort((a, b) => b.score.score - a.score.score).slice(0, p.topN);
  const tierA = new Set(eligible.filter((g) => g.score.tier === "A").map((g) => g.wallet.address));
  const watch = new Map(eligible.map((g) => [g.wallet.address, g.wallet]));
  const out: CopySignal[] = [];
  const opens: { w: CopyWallet; t: SmTrade }[] = [];
  for (const w of watch.values()) for (const t of w.trades) if (t.entry_t >= m0 && t.entry_t < m1 && liquid.has(t.coin)) opens.push({ w, t });
  opens.sort((a, b) => a.t.entry_t - b.t.entry_t);
  for (const o of opens) {
    if (tierA.has(o.w.address))
      out.push({ variant: "tier_a", coin: o.t.coin, side: o.t.side, t: o.t.entry_t, theirEntryPx: o.t.entry_px, theirExitT: o.t.exit_t, wallets: [o.w.address], source: sourceOf([o.w]) });
  }
  // Consensus: the moment a second (or later) watchlist wallet opens the same coin+side within the window.
  const lastSignal = new Map<string, number>();
  for (let i = 0; i < opens.length; i++) {
    const o = opens[i];
    const key = `${o.t.coin}|${o.t.side}`;
    const holders = opens.filter((x, j) => j < i && x.t.coin === o.t.coin && x.t.side === o.t.side && x.w.address !== o.w.address
      && o.t.entry_t - x.t.entry_t <= p.consensusHours * H1 && x.t.exit_t > o.t.entry_t);
    if (!holders.length) continue;
    if ((lastSignal.get(key) ?? -Infinity) > o.t.entry_t - p.consensusHours * H1) continue;
    lastSignal.set(key, o.t.entry_t);
    const group = [o, ...holders];
    out.push({
      variant: "consensus", coin: o.t.coin, side: o.t.side, t: o.t.entry_t,
      theirEntryPx: group.reduce((a, g) => a + g.t.entry_px, 0) / group.length,
      theirExitT: Math.min(...group.map((g) => g.t.exit_t)),
      wallets: group.map((g) => g.w.address), source: sourceOf(group.map((g) => g.w)),
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** First index with bar.t >= t (binary search), or -1. */
function firstAtOrAfter(bars: Bar[], t: number) {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].t >= t) { ans = m; hi = m - 1; } else lo = m + 1; }
  return ans;
}

/**
 * Follow one signal: enter at the open of the first 1h bar starting >= delay after their fill; stop = 1.5 x daily ATR(14);
 * T1 1.5R (half, then break-even), T2 3R; exit at the next 1h open after the source closes; 14-day max hold.
 * Returns null when skipped (no data, or price already ran more than 0.5R in their direction).
 */
export function simulateFollow(s: CopySignal, d: CoinHourly, p: CopyParams, splitT: number): CopyTrade | null {
  const i0 = firstAtOrAfter(d.c1h, s.t + p.delayMin * 60_000);
  if (i0 < 0) return null;
  const entry = d.c1h[i0].o;
  const dd = lastClosedDay(d.c1d, d.c1h[i0].t);
  const dATR = dd >= 0 ? atr(d.c1d, 14)[dd] : null;
  if (!dATR || !(entry > 0)) return null;
  const dir = s.side === "long" ? 1 : -1;
  const R = p.atrMult * dATR;
  if (dir * (entry - s.theirEntryPx) > p.maxMoveR * R) return null;
  const costRate = (p.feePct + p.slipPct) / 100;
  const pos: PosState = {
    entry, stop: entry - dir * R, R, t1: entry + dir * 1.5 * R, t2: entry + dir * 3 * R, dir: dir as 1 | -1,
    t1hit: false, remaining: 1, gross: 0, fee: (costRate * entry) / R, funding: 0, bars: 0,
  };
  const stop0 = pos.stop;
  const maxBars = p.maxHoldDays * 24;
  let exit: { px: number; reason: string; t: number } | null = null;
  for (let i = i0; i < d.c1h.length; i++) {
    const b = d.c1h[i];
    if (i > i0 && b.t >= s.theirExitT) { exit = { px: b.o, reason: "follow_exit", t: b.t }; break; }
    if (i > i0 && i - i0 >= maxBars) { exit = { px: b.o, reason: "max_hold", t: b.t }; break; }
    const ex = stepPosition(pos, b, d.f1h.get(b.t) ?? 0, costRate, { timeStop: Infinity, maxHold: Infinity });
    if (ex) { exit = { ...ex, t: b.t + H1 }; break; }
  }
  if (!exit) return null; // still open at the end of the data: excluded, as its result is unknown
  if (exit.reason === "follow_exit" || exit.reason === "max_hold") {
    pos.gross += (pos.remaining * (exit.px - pos.entry) * pos.dir) / pos.R;
    pos.fee += (costRate * exit.px * pos.remaining) / pos.R;
    pos.remaining = 0;
  }
  return {
    coin: s.coin, setup: "pullback_long", side: s.side, sample: d.c1h[i0].t < splitT ? "in" : "out",
    entry_t: d.c1h[i0].t, entry_px: entry, stop_px: stop0, t1_px: pos.t1, t2_px: pos.t2,
    exit_t: exit.t, exit_px: exit.px, exit_reason: exit.reason,
    gross_r: pos.gross, fee_r: pos.fee, funding_r: pos.funding, net_r: pos.gross - pos.fee - pos.funding, bars_held: pos.bars,
    variant: s.variant, source: s.source, wallets: s.wallets, month: monthKey(s.t),
  };
}

/** Keep at most `maxConcurrent` open copies and one per coin, in time order (as the live desk would). */
export function applyConcurrency(ts: CopyTrade[], maxConcurrent: number): CopyTrade[] {
  const kept: CopyTrade[] = [];
  for (const t of [...ts].sort((a, b) => a.entry_t - b.entry_t)) {
    const open = kept.filter((k) => k.entry_t <= t.entry_t && k.exit_t > t.entry_t);
    if (open.length >= maxConcurrent || open.some((k) => k.coin === t.coin)) continue;
    kept.push(t);
  }
  return kept;
}

export function copySummary(ts: CopyTrade[], p: CopyParams) {
  const st = (xs: CopyTrade[]) => {
    const s = stats(xs as BtTrade[]);
    return { ...s, ...equityAt(xs, p.riskPct) };
  };
  const by = (f: (t: CopyTrade) => boolean) => st(ts.filter(f));
  const all = st(ts), inS = by((t) => t.sample === "in"), outS = by((t) => t.sample === "out");
  const gate = {
    trades_ge_60: all.trades >= 60,
    expectancy_pos_in: inS.expectancy_r > 0,
    expectancy_pos_out: outS.expectancy_r > 0,
    max_dd_lt_20: all.max_drawdown_pct < 20,
  };
  return {
    all, in: inS, out: outS,
    by_source: { leaderboard: by((t) => t.source === "leaderboard"), invo: by((t) => t.source === "invo"), both: by((t) => t.source === "both") },
    by_month: Object.fromEntries(Array.from(new Set(ts.map((t) => t.month))).sort().map((m) => [m, st(ts.filter((t) => t.month === m))])),
    gate: { ...gate, pass: Object.values(gate).every(Boolean) },
  };
}

/** Compounded equity at riskPct per trade (sized off realized equity at entry), like engine.equitySim. */
function equityAt(ts: CopyTrade[], riskPct: number) {
  type Ev = { t: number; kind: 0 | 1; tr: CopyTrade };
  const evs: Ev[] = [];
  ts.forEach((tr) => { evs.push({ t: tr.entry_t, kind: 1, tr }); evs.push({ t: tr.exit_t, kind: 0, tr }); });
  evs.sort((a, b) => a.t - b.t || a.kind - b.kind);
  let eq = 1, peak = 1, mdd = 0;
  const risk = new Map<CopyTrade, number>();
  for (const e of evs) {
    if (e.kind === 1) risk.set(e.tr, eq * riskPct);
    else { eq += (risk.get(e.tr) ?? eq * riskPct) * e.tr.net_r; peak = Math.max(peak, eq); mdd = Math.max(mdd, (peak - eq) / peak); }
  }
  return { final_return_pct: Math.round((eq - 1) * 10000) / 100, max_drawdown_pct: Math.round(mdd * 10000) / 100 };
}

/** The whole walk-forward run for both variants. */
export function runCopyBacktest(wallets: CopyWallet[], coins: Map<string, CoinHourly>, liquid: Set<string>, now: number, p: CopyParams = DEFAULT_COPY_PARAMS) {
  const allT = wallets.flatMap((w) => w.trades.map((t) => t.entry_t));
  if (!allT.length) return { months: [] as string[], variants: {} as Record<CopyVariant, ReturnType<typeof copySummary>>, trades: [] as CopyTrade[], signals: 0 };
  const months = walkForwardMonths(Math.min(...allT), now);
  if (!months.length) return { months: [], variants: {} as Record<CopyVariant, ReturnType<typeof copySummary>>, trades: [], signals: 0 };
  const end = Math.min(now, Date.UTC(new Date(months[months.length - 1]).getUTCFullYear(), new Date(months[months.length - 1]).getUTCMonth() + 1, 1));
  const splitT = months[0] + 0.6 * (end - months[0]);
  const raw: CopyTrade[] = [];
  let signals = 0;
  for (let k = 0; k < months.length; k++) {
    const m0 = months[k], m1 = k + 1 < months.length ? months[k + 1] : now;
    for (const s of monthSignals(wallets, m0, m1, liquid, p)) {
      signals++;
      const d = coins.get(s.coin);
      if (!d) continue;
      const tr = simulateFollow(s, d, p, splitT);
      if (tr) raw.push(tr);
    }
  }
  const trades: CopyTrade[] = [];
  const variants = {} as Record<CopyVariant, ReturnType<typeof copySummary>>;
  for (const v of ["tier_a", "consensus"] as CopyVariant[]) {
    const kept = applyConcurrency(raw.filter((t) => t.variant === v), p.maxConcurrent);
    trades.push(...kept);
    variants[v] = copySummary(kept, p);
  }
  return { months: months.map(monthKey), variants, trades, signals };
}
