import { describe, it, expect } from "vitest";
import { equitySim, lastClosedDay, stats, type BtTrade } from "./engine";

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
