import { describe, it, expect } from "vitest";
import { equitySim, lastClosedDay, stats, prep, signalsAt, stepPosition, mgmtFor, VB, type Bar, type BtTrade, type CoinData, type PosState } from "./engine";

const D = 86400_000;
const tr = (net: number, entry: number, exit: number): BtTrade => ({
  coin: "X", setup: "pullback_long", side: "long", sample: "in", entry_t: entry, entry_px: 1, stop_px: 0.9,
  t1_px: 1.15, t2_px: 1.3, exit_t: exit, exit_px: 1, exit_reason: "t2", gross_r: net, fee_r: 0, funding_r: 0, net_r: net, bars_held: 1,
});

describe("engine rules", () => {
  it("4H bar may only use fully closed days", () => {
    const days = [0, 1, 2].map((i) => ({ t: i * D, o: 1, h: 1, l: 1, c: 1, v: 1 }));
    expect(lastClosedDay(days, 2 * D)).toBe(1); // day 2 opens at 2D, not closed yet
    expect(lastClosedDay(days, 2 * D - 1)).toBe(0);
  });
  it("max drawdown in R is sequential by exit time", () => {
    const s = stats([tr(2, 0, 1), tr(-1, 1, 2), tr(-1.5, 2, 3), tr(3, 3, 4)]);
    expect(s.max_drawdown_r).toBe(2.5);
    expect(s.trades).toBe(4);
  });
  it("equity sim compounds at 1% risk", () => {
    const e = equitySim([tr(3, 0, 1), tr(-1, 2, 3)]);
    expect(e.final_return_pct).toBe(1.97); // 1.03 * 0.99 - 1
  });
});

// ---------------------------------------------------------------------------------------------
// volume_breakout + per-setup management
// ---------------------------------------------------------------------------------------------
const H4 = 4 * 3600_000;
function coin(n: number, last: Partial<Bar> & { volMult: number; jump: number }): CoinData {
  const c4h: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const c = 100 + 0.05 * i;
    c4h.push({ t: i * H4, o: c - 0.05, h: c + 0.5, l: c - 0.5, c, v: 100 });
  }
  const prevHigh = Math.max(...c4h.slice(n - 1 - VB.channel, n - 1).map((b) => b.h));
  const o = c4h[n - 2].c;
  const cl = prevHigh + last.jump;
  c4h[n - 1] = { t: (n - 1) * H4, o, h: cl + 0.2, l: o - 0.1, c: cl, v: 100 * last.volMult };
  const c1d: Bar[] = [];
  for (let i = 0; i + 6 <= n; i += 6) {
    const g = c4h.slice(i, i + 6);
    c1d.push({ t: g[0].t, o: g[0].o, h: Math.max(...g.map((b) => b.h)), l: Math.min(...g.map((b) => b.l)), c: g[5].c, v: g.reduce((a, b) => a + b.v, 0) });
  }
  return { coin: "X", c4h, c1d, f4h: new Map() };
}

describe("volume_breakout", () => {
  const n = 300;
  it("fires on a close above the prior 18-bar high with > 2x volume, stop 3 x 4H ATR below", () => {
    const p = prep(coin(n, { volMult: 3, jump: 1 }));
    const s = signalsAt(p, n - 1, null);
    expect(s?.setup).toBe("volume_breakout");
    expect(s?.side).toBe("long");
    expect(s!.stop).toBeCloseTo(p.c4h[n - 1].c - 3 * p.atr4[n - 1]!, 9);
  });
  it("needs the volume surge", () => {
    const p = prep(coin(n, { volMult: 1.5, jump: 1 }));
    expect(signalsAt(p, n - 1, null)).toBeNull();
  });
  it("respects the enabled setups", () => {
    const p = prep(coin(n, { volMult: 3, jump: 1 }));
    expect(signalsAt(p, n - 1, null, new Set(["pullback_long"]))).toBeNull();
    expect(signalsAt(p, n - 1, null, new Set(["volume_breakout"]))?.setup).toBe("volume_breakout");
  });
});

describe("per-setup management", () => {
  const pos = (m = mgmtFor("volume_breakout")): PosState => ({
    entry: 100, stop: 90, R: 10, t1: 100 + m.t1R * 10, t2: 100 + m.t2R * 10, dir: 1, t1hit: false, remaining: 1, gross: 0, fee: 0, funding: 0, bars: 0,
  });
  const bar = (h: number, l: number, c = (h + l) / 2): Bar => ({ t: 0, o: c, h, l, c, v: 1 });
  it("volume_breakout takes half at +1R and leaves the stop in place", () => {
    const m = mgmtFor("volume_breakout");
    const p = pos();
    expect(stepPosition(p, bar(111, 101), 0, 0, m, m)).toBeNull();
    expect(p.t1hit).toBe(true);
    expect(p.remaining).toBeCloseTo(0.5);
    expect(p.stop).toBe(90); // not moved to break-even
    const ex = stepPosition(p, bar(100, 89), 0, 0, m, m);
    expect(ex?.reason).toBe("stop");
    expect(p.gross).toBeCloseTo(0); // +0.5R on the first half, -0.5R on the second
  });
  it("volume_breakout exits the rest at +4R or after 42 bars", () => {
    const m = mgmtFor("volume_breakout");
    const a = pos();
    stepPosition(a, bar(111, 101), 0, 0, m, m);
    expect(stepPosition(a, bar(141, 120), 0, 0, m, m)?.reason).toBe("t2");
    expect(a.gross).toBeCloseTo(0.5 * 1 + 0.5 * 4);
    const b = pos();
    let ex = null;
    for (let i = 0; i < 42 && !ex; i++) ex = stepPosition(b, bar(105, 95, 104), 0, 0, m, m);
    expect(b.bars).toBe(42);
    expect(ex?.reason).toBe("time_stop");
  });
  it("other setups keep the original management (half at 1.5R, then break-even)", () => {
    const m = mgmtFor("pullback_long");
    expect(m).toMatchObject({ t1R: 1.5, t2R: 3, t1Frac: 0.5, beAfterT1: true, timeStop: 42, maxHold: 84 });
    const p = pos(m);
    stepPosition(p, bar(116, 101), 0, 0, m, m);
    expect(p.stop).toBe(100);
  });
});
