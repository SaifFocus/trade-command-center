// Pure: rebuild closed trades from Hyperliquid fills, and compute wallet metrics as of a point in time.
export type Fill = {
  coin: string; px: string; sz: string; side: "B" | "A"; time: number; startPosition: string;
  dir: string; closedPnl: string; fee: string; liquidation?: unknown;
};
export type SmTrade = {
  coin: string; side: "long" | "short"; entry_t: number; exit_t: number; entry_px: number; exit_px: number;
  max_notional: number; net_pnl: number; fees: number; hold_h: number; liquidated: boolean;
};
/** [ms, value] series */
export type Series = [number, number][];
export type Portfolio = { av: Series; pnl: Series };

const isPerp = (coin: string) => !coin.startsWith("@") && !coin.includes("/");

export function fillsToTrades(fills: Fill[]): SmTrade[] {
  const byCoin = new Map<string, Fill[]>();
  for (const f of fills) {
    if (!isPerp(f.coin)) continue;
    (byCoin.get(f.coin) ?? byCoin.set(f.coin, []).get(f.coin)!).push(f);
  }
  const out: SmTrade[] = [];
  for (const [coin, fs] of byCoin) {
    fs.sort((a, b) => a.time - b.time);
    let cur: (SmTrade & { pos: number; openSz: number; openCost: number; closeSz: number; closeVal: number }) | null = null;
    let started = false; // only count trades whose opening fill we saw
    for (const f of fs) {
      const start = +f.startPosition;
      const sz = +f.sz;
      const signed = f.side === "B" ? sz : -sz;
      const px = +f.px;
      const liq = f.liquidation != null || /liquidat/i.test(f.dir);
      if (!started) { if (Math.abs(start) > 1e-12) continue; started = true; }
      let remainingFill = signed;
      let pos = start;
      // Handle flips (position crosses zero within one fill) by splitting.
      while (Math.abs(remainingFill) > 1e-12) {
        if (!cur) {
          if (Math.abs(pos) > 1e-12) break; // inconsistent; skip
          cur = { coin, side: remainingFill > 0 ? "long" : "short", entry_t: f.time, exit_t: f.time, entry_px: px, exit_px: px,
            max_notional: 0, net_pnl: 0, fees: 0, hold_h: 0, liquidated: false, pos: 0, openSz: 0, openCost: 0, closeSz: 0, closeVal: 0 };
        }
        const dir = cur.side === "long" ? 1 : -1;
        const opening = Math.sign(remainingFill) === dir;
        const part = opening ? remainingFill : dir * Math.min(Math.abs(remainingFill), Math.abs(cur.pos)) * -1;
        const frac = Math.abs(part) / Math.abs(signed);
        cur.fees += +f.fee * frac;
        if (opening) { cur.openSz += Math.abs(part); cur.openCost += Math.abs(part) * px; }
        else { cur.closeSz += Math.abs(part); cur.closeVal += Math.abs(part) * px; cur.net_pnl += +f.closedPnl * frac; if (liq) cur.liquidated = true; }
        cur.pos += part;
        pos = cur.pos;
        cur.max_notional = Math.max(cur.max_notional, Math.abs(cur.pos) * px);
        remainingFill -= part;
        if (Math.abs(cur.pos) < 1e-9 * Math.max(1, cur.openSz)) {
          cur.exit_t = f.time;
          cur.entry_px = cur.openSz ? cur.openCost / cur.openSz : px;
          cur.exit_px = cur.closeSz ? cur.closeVal / cur.closeSz : px;
          cur.net_pnl -= cur.fees;
          cur.hold_h = (cur.exit_t - cur.entry_t) / 3600_000;
          const { pos: _p, openSz: _a, openCost: _b, closeSz: _c, closeVal: _d, ...t } = cur;
          out.push(t);
          cur = null; pos = 0;
        }
      }
    }
  }
  return out.sort((a, b) => a.exit_t - b.exit_t);
}

const DAY = 86400_000;
const WEEK = 7 * DAY;
function valueAt(s: Series, t: number): number | null {
  let v: number | null = null;
  for (const [x, y] of s) { if (x <= t) v = y; else break; }
  return v;
}
function quantile(xs: number[], q: number) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

/** Return (% of avg account value) and max drawdown (% from peak equity) over [asOf-days, asOf]. */
export function windowPerf(p: Portfolio, asOf: number, days: number) {
  const from = asOf - days * DAY;
  const pnl = p.pnl.filter(([t]) => t <= asOf);
  const av = p.av.filter(([t]) => t >= from && t <= asOf).map(([, v]) => v);
  const p0 = valueAt(pnl, from) ?? (pnl.find(([t]) => t >= from)?.[1] ?? null);
  const p1 = valueAt(pnl, asOf);
  if (p0 == null || p1 == null || !av.length) return { ret: null, mdd: null };
  const avg = av.reduce((a, b) => a + b, 0) / av.length;
  if (!(avg > 0)) return { ret: null, mdd: null };
  const ret = ((p1 - p0) / avg) * 100;
  const base = valueAt(p.av, from) ?? av[0];
  let peak = -Infinity, mdd = 0;
  for (const [t, v] of pnl) {
    if (t < from) continue;
    const eq = Math.max(base, 1e-9) + (v - p0);
    peak = Math.max(peak, eq);
    if (peak > 0) mdd = Math.max(mdd, ((peak - eq) / peak) * 100);
  }
  return { ret, mdd };
}

export type Metrics = {
  ret_30: number | null; ret_90: number | null; ret_180: number | null;
  mdd_30: number | null; mdd_90: number | null; mdd_180: number | null;
  wweeks_30: number | null; wweeks_90: number | null; wweeks_180: number | null;
  active_weeks: number; trades: number; win_rate: number | null; win_loss: number | null; profit_factor: number | null; expectancy: number | null;
  top1_share: number | null; top4_share: number | null; median_hold_h: number | null; p25_hold_h: number | null;
  avg_lev: number | null; max_lev: number | null; liquidations: number; last_trade_at: number | null; liquid_share: number | null;
  age_days: number; lifetime_pnl: number | null; account_value: number | null;
};

/** All metrics using only data available at asOf (trades must have exit_t <= asOf to count as closed). */
export function computeMetrics(allTrades: SmTrade[], p: Portfolio, asOf: number, liquidCoins: Set<string>, firstSeen?: number): Metrics {
  const trades = allTrades.filter((t) => t.exit_t <= asOf && t.exit_t > asOf - 180 * DAY);
  const w30 = windowPerf(p, asOf, 30), w90 = windowPerf(p, asOf, 90), w180 = windowPerf(p, asOf, 180);
  const wins = trades.filter((t) => t.net_pnl > 0), losses = trades.filter((t) => t.net_pnl <= 0);
  const gp = wins.reduce((a, t) => a + t.net_pnl, 0), gl = -losses.reduce((a, t) => a + t.net_pnl, 0);
  const n = trades.length;
  const sortedWins = wins.map((t) => t.net_pnl).sort((a, b) => b - a);
  const holds = trades.map((t) => t.hold_h);
  const levs: number[] = [];
  let liqNot = 0, totNot = 0;
  for (const t of trades) {
    const av = valueAt(p.av, t.entry_t) ?? valueAt(p.av, t.exit_t);
    if (av && av > 0) levs.push(t.max_notional / av);
    totNot += t.max_notional;
    if (liquidCoins.has(t.coin)) liqNot += t.max_notional;
  }
  // Weekly consistency: active week = any trade overlapping it; winning = net realized pnl in that week > 0.
  const weeks = (days: number) => {
    const from = asOf - days * DAY;
    const act = new Set<number>(), pnl = new Map<number, number>();
    for (const t of allTrades) {
      if (t.entry_t > asOf || t.exit_t < from) continue;
      const a = Math.floor(Math.max(t.entry_t, from) / WEEK), b = Math.floor(Math.min(t.exit_t, asOf) / WEEK);
      for (let w = a; w <= b; w++) act.add(w);
      if (t.exit_t <= asOf && t.exit_t >= from) { const w = Math.floor(t.exit_t / WEEK); pnl.set(w, (pnl.get(w) ?? 0) + t.net_pnl); }
    }
    let win = 0; for (const w of act) if ((pnl.get(w) ?? 0) > 0) win++;
    return { pct: act.size ? (win / act.size) * 100 : null, active: act.size };
  };
  const wk30 = weeks(30), wk90 = weeks(90), wk180 = weeks(180);
  const firstAv = p.av.find(([, v]) => v > 0)?.[0];
  const firstTrade = allTrades.length ? Math.min(...allTrades.map((t) => t.entry_t)) : undefined;
  const start = Math.min(...[firstAv, firstTrade, firstSeen].filter((x): x is number => x != null && x <= asOf), asOf);
  return {
    ret_30: w30.ret, ret_90: w90.ret, ret_180: w180.ret, mdd_30: w30.mdd, mdd_90: w90.mdd, mdd_180: w180.mdd,
    wweeks_30: wk30.pct, wweeks_90: wk90.pct, wweeks_180: wk180.pct, active_weeks: wk180.active,
    trades: n, win_rate: n ? (wins.length / n) * 100 : null,
    win_loss: wins.length && losses.length && gl > 0 ? (gp / wins.length) / (gl / losses.length) : null,
    profit_factor: gl > 0 ? gp / gl : gp > 0 ? 99 : null,
    expectancy: n ? (gp - gl) / n : null,
    top1_share: gp > 0 ? ((sortedWins[0] ?? 0) / gp) * 100 : null,
    top4_share: gp > 0 ? (sortedWins.slice(0, 4).reduce((a, b) => a + b, 0) / gp) * 100 : null,
    median_hold_h: quantile(holds, 0.5), p25_hold_h: quantile(holds, 0.25),
    avg_lev: levs.length ? levs.reduce((a, b) => a + b, 0) / levs.length : null, max_lev: levs.length ? Math.max(...levs) : null,
    liquidations: trades.filter((t) => t.liquidated).length,
    last_trade_at: allTrades.filter((t) => t.entry_t <= asOf).reduce<number | null>((m, t) => Math.max(m ?? 0, Math.min(t.exit_t, asOf)), null),
    liquid_share: totNot > 0 ? (liqNot / totNot) * 100 : null,
    age_days: (asOf - start) / DAY,
    lifetime_pnl: valueAt(p.pnl, asOf), account_value: valueAt(p.av, asOf),
  };
}
