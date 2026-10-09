// Deterministic swing backtest engine. Pure (no I/O). Results in R-multiples.
export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
export type CoinData = { coin: string; c4h: Bar[]; c1d: Bar[]; f4h: Map<number, { s: number; n: number }> };
export type Params = { name: string; feePct: number; slipPct: number };
export type Setup = "pullback_long" | "breakout_retest_long" | "breakdown_retest_short" | "crowded_long_squeeze_short";

export type BtTrade = {
  coin: string; setup: Setup; side: "long" | "short"; sample: "in" | "out";
  entry_t: number; entry_px: number; stop_px: number; t1_px: number; t2_px: number;
  exit_t: number; exit_px: number; exit_reason: string;
  gross_r: number; fee_r: number; funding_r: number; net_r: number; bars_held: number;
};

const H4 = 4 * 3600_000;
const D1 = 86400_000;

export function ema(vals: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(vals.length).fill(null);
  if (vals.length < n) return out;
  let e = vals.slice(0, n).reduce((a, b) => a + b, 0) / n;
  out[n - 1] = e;
  const k = 2 / (n + 1);
  for (let i = n; i < vals.length; i++) { e = vals[i] * k + e * (1 - k); out[i] = e; }
  return out;
}

export function atr(bars: Bar[], n = 14): (number | null)[] {
  const out: (number | null)[] = new Array(bars.length).fill(null);
  const tr = bars.map((b, i) => (i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c))));
  if (bars.length < n) return out;
  let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
  out[n - 1] = a;
  for (let i = n; i < bars.length; i++) { a = (a * (n - 1) + tr[i]) / n; out[i] = a; }
  return out;
}

type Daily = {
  bars: Bar[]; ema50: (number | null)[]; ema200: (number | null)[]; atr: (number | null)[];
  avgVol20: (number | null)[]; hh30: (number | null)[]; ll30: (number | null)[]; hhIncl30: (number | null)[];
};

function dailyInd(bars: Bar[]): Daily {
  const c = bars.map((b) => b.c);
  const n = bars.length;
  const avgVol20: (number | null)[] = new Array(n).fill(null);
  const hh30: (number | null)[] = new Array(n).fill(null);
  const ll30: (number | null)[] = new Array(n).fill(null);
  const hhIncl30: (number | null)[] = new Array(n).fill(null);
  for (let d = 0; d < n; d++) {
    if (d >= 20) { let s = 0; for (let j = d - 20; j < d; j++) s += bars[j].v; avgVol20[d] = s / 20; }
    if (d >= 30) {
      let hi = -Infinity, lo = Infinity;
      for (let j = d - 30; j < d; j++) { hi = Math.max(hi, bars[j].h); lo = Math.min(lo, bars[j].l); }
      hh30[d] = hi; ll30[d] = lo;
    }
    if (d >= 29) { let hi = -Infinity; for (let j = d - 29; j <= d; j++) hi = Math.max(hi, bars[j].h); hhIncl30[d] = hi; }
  }
  return { bars, ema50: ema(c, 50), ema200: ema(c, 200), atr: atr(bars, 14), avgVol20, hh30, ll30, hhIncl30 };
}

/** Index of last daily bar fully closed at time T (close = t + 1d <= T). -1 if none. */
export function lastClosedDay(bars: Bar[], T: number): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].t + D1 <= T) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}

function percentile(vals: number[], p: number) {
  const s = [...vals].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

type Prep = {
  coin: string; c4h: Bar[]; idx: Map<number, number>; d: Daily;
  ema20: (number | null)[]; ema50: (number | null)[]; atr4: (number | null)[];
  fund4: number[]; fund24: (number | null)[];
  levelsLong: { level: number; from: number; to: number; used: boolean }[];
  levelsShort: { level: number; from: number; to: number; used: boolean }[];
};

function prep(cd: CoinData): Prep {
  const c4h = cd.c4h;
  const d = dailyInd(cd.c1d);
  const closes = c4h.map((b) => b.c);
  const fund4 = c4h.map((b) => cd.f4h.get(b.t)?.s ?? 0);
  const fundN = c4h.map((b) => cd.f4h.get(b.t)?.n ?? 0);
  const fund24: (number | null)[] = c4h.map((_, i) => {
    if (i < 5) return null;
    let s = 0, n = 0;
    for (let j = i - 5; j <= i; j++) { s += fund4[j]; n += fundN[j]; }
    return n >= 12 ? s / n : null;
  });
  const levelsLong: Prep["levelsLong"] = [];
  const levelsShort: Prep["levelsShort"] = [];
  d.bars.forEach((b, i) => {
    const av = d.avgVol20[i];
    if (av == null) return;
    const from = b.t + D1, to = from + 5 * D1;
    if (d.hh30[i] != null && b.c > d.hh30[i]! && b.v >= 1.5 * av) levelsLong.push({ level: d.hh30[i]!, from, to, used: false });
    if (d.ll30[i] != null && b.c < d.ll30[i]! && b.v >= 1.5 * av) levelsShort.push({ level: d.ll30[i]!, from, to, used: false });
  });
  return {
    coin: cd.coin, c4h, idx: new Map(c4h.map((b, i) => [b.t, i])), d,
    ema20: ema(closes, 20), ema50: ema(closes, 50), atr4: atr(c4h, 14), fund4, fund24, levelsLong, levelsShort,
  };
}

type Signal = { coin: string; setup: Setup; side: "long" | "short"; stop: number };

function signalsAt(p: Prep, i: number, riskOn: boolean | null): Signal | null {
  const b = p.c4h[i];
  const T = b.t + H4;
  const dd = lastClosedDay(p.d.bars, T);
  if (dd < 0) return null;
  const dATR = p.d.atr[dd];
  if (dATR == null) return null;
  const db = p.d.bars[dd];
  const e20 = p.ema20[i], e50 = p.ema50[i], a4 = p.atr4[i];
  const cands: Signal[] = [];

  // A pullback_long
  if (riskOn === true && e20 != null && e50 != null && a4 != null && i >= 5) {
    const de50 = p.d.ema50[dd], de200 = p.d.ema200[dd];
    if (de50 != null && de200 != null && db.c > de50 && de50 > de200) {
      const near = Math.abs(b.l - e20) <= 0.5 * a4 || Math.abs(b.l - e50) <= 0.5 * a4;
      if (near && b.c > e20 && b.c > b.o) {
        let lo = Infinity; for (let j = i - 5; j <= i; j++) lo = Math.min(lo, p.c4h[j].l);
        cands.push({ coin: p.coin, setup: "pullback_long", side: "long", stop: lo - 0.1 * dATR });
      }
    }
  }
  // B breakout_retest_long
  if (riskOn === true) {
    for (const L of p.levelsLong) {
      if (L.used || b.t < L.from || T > L.to) continue;
      if (Math.abs(b.l - L.level) <= 0.005 * L.level && b.c > L.level) {
        L.used = true;
        cands.push({ coin: p.coin, setup: "breakout_retest_long", side: "long", stop: L.level - dATR });
        break;
      }
    }
  }
  // C breakdown_retest_short
  if (riskOn === false) {
    for (const L of p.levelsShort) {
      if (L.used || b.t < L.from || T > L.to) continue;
      if (Math.abs(b.h - L.level) <= 0.005 * L.level && b.c < L.level) {
        L.used = true;
        cands.push({ coin: p.coin, setup: "breakdown_retest_short", side: "short", stop: L.level + dATR });
        break;
      }
    }
  }
  // D crowded_long_squeeze_short (any regime)
  const hh = p.d.hhIncl30[dd], f24 = p.fund24[i];
  if (hh != null && f24 != null && i >= 1 && b.c >= 0.98 * hh && b.c < p.c4h[i - 1].l) {
    const hist: number[] = [];
    for (let j = Math.max(0, i - 540); j < i; j++) { const v = p.fund24[j]; if (v != null) hist.push(v); }
    if (hist.length >= 270 && f24 > percentile(hist, 0.9)) {
      cands.push({ coin: p.coin, setup: "crowded_long_squeeze_short", side: "short", stop: hh + 0.5 * dATR });
    }
  }
  return cands[0] ?? null;
}

type Pos = {
  sig: Signal; coin: string; entryIdx: number; entry: number; stop: number; R: number; t1: number; t2: number;
  dir: 1 | -1; t1hit: boolean; remaining: number; gross: number; fee: number; funding: number; bars: number; entry_t: number;
};

export function runBacktest(coins: CoinData[], params: Params, btcCoin = "BTC") {
  const preps = new Map(coins.filter((c) => c.c4h.length && c.c1d.length).map((c) => [c.coin, prep(c)]));
  const btc = preps.get(btcCoin);
  if (!btc) throw new Error("BTC data missing");
  const times = Array.from(new Set(Array.from(preps.values()).flatMap((p) => p.c4h.map((b) => b.t)))).sort((a, b) => a - b);
  const startT = times[0], endT = times[times.length - 1] + H4;
  const splitT = startT + 0.6 * (endT - startT);
  const costRate = (params.feePct + params.slipPct) / 100;
  const coinNames = Array.from(preps.keys()).sort();

  const open = new Map<string, Pos>();
  let pending: Signal[] = [];
  const trades: BtTrade[] = [];

  const close = (p: Pos, frac: number, px: number) => {
    p.gross += (frac * (px - p.entry) * p.dir) / p.R;
    p.fee += (costRate * px * frac) / p.R;
    p.remaining -= frac;
  };
  const finish = (p: Pos, t: number, px: number, reason: string) => {
    close(p, p.remaining, px);
    const net = p.gross - p.fee - p.funding;
    trades.push({
      coin: p.coin, setup: p.sig.setup, side: p.sig.side, sample: p.entry_t < splitT ? "in" : "out",
      entry_t: p.entry_t, entry_px: p.entry, stop_px: p.sig.stop, t1_px: p.t1, t2_px: p.t2,
      exit_t: t, exit_px: px, exit_reason: reason,
      gross_r: p.gross, fee_r: p.fee, funding_r: p.funding, net_r: net, bars_held: p.bars,
    });
    open.delete(p.coin);
  };

  for (const T of times) {
    // 1) enter pending signals at this bar's open
    for (const s of pending) {
      const p = preps.get(s.coin)!;
      const i = p.idx.get(T);
      if (i == null) continue;
      const entry = p.c4h[i].o;
      const R = Math.abs(entry - s.stop);
      const dd = lastClosedDay(p.d.bars, T);
      const dATR = dd >= 0 ? p.d.atr[dd] : null;
      if (!dATR || R < dATR || R > 3 * dATR) continue;
      if ((s.side === "long" && s.stop >= entry) || (s.side === "short" && s.stop <= entry)) continue;
      const dir = s.side === "long" ? 1 : -1;
      open.set(s.coin, {
        sig: s, coin: s.coin, entryIdx: i, entry, stop: s.stop, R, t1: entry + dir * 1.5 * R, t2: entry + dir * 3 * R,
        dir, t1hit: false, remaining: 1, gross: 0, fee: (costRate * entry) / R, funding: 0, bars: 0, entry_t: T,
      });
    }
    pending = [];

    // 2) manage open positions on this bar
    for (const pos of Array.from(open.values())) {
      const p = preps.get(pos.coin)!;
      const i = p.idx.get(T);
      if (i == null) continue;
      const b = p.c4h[i];
      pos.bars++;
      pos.funding += (pos.dir * p.fund4[i] * pos.entry * pos.remaining) / pos.R;
      const hitStop = pos.dir === 1 ? b.l <= pos.stop : b.h >= pos.stop;
      if (!pos.t1hit) {
        if (hitStop) { finish(pos, T, pos.stop, "stop"); continue; }
        const hitT1 = pos.dir === 1 ? b.h >= pos.t1 : b.l <= pos.t1;
        if (hitT1) {
          close(pos, 0.5, pos.t1);
          pos.t1hit = true;
          pos.stop = pos.entry;
          const beHit = pos.dir === 1 ? b.l <= pos.entry : b.h >= pos.entry;
          if (beHit) { finish(pos, T, pos.entry, "breakeven"); continue; }
          const hitT2 = pos.dir === 1 ? b.h >= pos.t2 : b.l <= pos.t2;
          if (hitT2) { finish(pos, T, pos.t2, "t2"); continue; }
        }
      } else {
        if (hitStop) { finish(pos, T, pos.stop, "breakeven"); continue; }
        const hitT2 = pos.dir === 1 ? b.h >= pos.t2 : b.l <= pos.t2;
        if (hitT2) { finish(pos, T, pos.t2, "t2"); continue; }
      }
      if (!pos.t1hit && pos.bars >= 42) { finish(pos, T, b.c, "time_stop"); continue; }
      if (pos.bars >= 84) { finish(pos, T, b.c, "max_hold"); continue; }
    }

    // 3) signals at this bar's close (entries next bar)
    const btcDay = lastClosedDay(btc.d.bars, T + H4);
    const be200 = btcDay >= 0 ? btc.d.ema200[btcDay] : null;
    const riskOn = be200 == null ? null : btc.d.bars[btcDay].c > be200;
    for (const coin of coinNames) {
      if (open.size + pending.length >= 4) break;
      if (open.has(coin)) continue;
      const p = preps.get(coin)!;
      const i = p.idx.get(T);
      if (i == null) continue;
      const s = signalsAt(p, i, riskOn);
      if (s) pending.push(s);
    }
  }
  // close anything still open at the last bar's close
  for (const pos of Array.from(open.values())) {
    const p = preps.get(pos.coin)!;
    const last = p.c4h[p.c4h.length - 1];
    finish(pos, last.t, last.c, "end_of_data");
  }
  trades.sort((a, b) => a.exit_t - b.exit_t || a.coin.localeCompare(b.coin));
  return { trades, startT, endT, splitT };
}

export function stats(ts: BtTrade[]) {
  const n = ts.length;
  const wins = ts.filter((t) => t.net_r > 0);
  const pos = wins.reduce((a, t) => a + t.net_r, 0);
  const neg = ts.filter((t) => t.net_r <= 0).reduce((a, t) => a + t.net_r, 0);
  const sum = ts.reduce((a, t) => a + t.net_r, 0);
  let cum = 0, peak = 0, mdd = 0;
  for (const t of [...ts].sort((a, b) => a.exit_t - b.exit_t)) { cum += t.net_r; peak = Math.max(peak, cum); mdd = Math.max(mdd, peak - cum); }
  const avgWin = wins.length ? pos / wins.length : 0;
  const losses = n - wins.length;
  const avgLoss = losses ? -neg / losses : 0;
  const wr = n ? wins.length / n : 0;
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    trades: n, win_rate: r(wr), avg_net_r: r(n ? sum / n : 0),
    expectancy_r: r(wr * avgWin - (1 - wr) * avgLoss),
    profit_factor: neg === 0 ? (pos > 0 ? null : 0) : r(pos / -neg), max_drawdown_r: r(mdd),
    ...equitySim(ts),
  };
}

/** Compounded equity at 1% risk per trade; risk sized off realized equity at entry. */
export function equitySim(ts: BtTrade[], riskPct = 0.01) {
  type Ev = { t: number; kind: 0 | 1; tr: BtTrade };
  const evs: Ev[] = [];
  ts.forEach((tr) => { evs.push({ t: tr.entry_t, kind: 1, tr }); evs.push({ t: tr.exit_t, kind: 0, tr }); });
  evs.sort((a, b) => a.t - b.t || a.kind - b.kind);
  let eq = 1, peak = 1, mdd = 0;
  const risk = new Map<BtTrade, number>();
  for (const e of evs) {
    if (e.kind === 1) risk.set(e.tr, eq * riskPct);
    else {
      eq += (risk.get(e.tr) ?? eq * riskPct) * e.tr.net_r;
      peak = Math.max(peak, eq);
      mdd = Math.max(mdd, (peak - eq) / peak);
    }
  }
  return { final_return_pct: Math.round((eq - 1) * 10000) / 100, max_drawdown_pct: Math.round(mdd * 10000) / 100 };
}

export function summarize(ts: BtTrade[]) {
  const setups: Setup[] = ["pullback_long", "breakout_retest_long", "breakdown_retest_short", "crowded_long_squeeze_short"];
  const by_setup_sample: Record<string, ReturnType<typeof stats>> = {};
  for (const s of setups) for (const smp of ["in", "out"] as const)
    by_setup_sample[`${s}:${smp}`] = stats(ts.filter((t) => t.setup === s && t.sample === smp));
  const all = stats(ts);
  const inS = stats(ts.filter((t) => t.sample === "in"));
  const outS = stats(ts.filter((t) => t.sample === "out"));
  const gate = {
    trades_ge_100: all.trades >= 100,
    expectancy_pos_in: inS.expectancy_r > 0,
    expectancy_pos_out: outS.expectancy_r > 0,
    max_dd_lt_20: all.max_drawdown_pct < 20,
  };
  return { all, in: inS, out: outS, by_setup_sample, gate: { ...gate, pass: Object.values(gate).every(Boolean) } };
}
