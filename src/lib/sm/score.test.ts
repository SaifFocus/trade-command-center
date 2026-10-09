import { describe, it, expect } from "vitest";
import { profitScore, PROFIT_TH, riskScore, consistencyScore, CONS_TH, trackScore, scoreWallet } from "./score";
import { fillsToTrades, type Fill } from "./positions";
import type { Metrics } from "./positions";

const good: Metrics = {
  ret_30: 8, ret_90: 25, ret_180: 50, mdd_30: 3, mdd_90: 5, mdd_180: 8, wweeks_30: 100, wweeks_90: 90, wweeks_180: 85,
  active_weeks: 26, trades: 120, win_rate: 60, win_loss: 1.5, profit_factor: 2, expectancy: 10, top1_share: 10, top4_share: 30,
  median_hold_h: 48, p25_hold_h: 24, avg_lev: 3, max_lev: 5, liquidations: 0, last_trade_at: 1000, liquid_share: 90,
  age_days: 400, lifetime_pnl: 1000, account_value: 10000,
};

describe("score bands", () => {
  it("profitability 30d", () => {
    expect(profitScore(7.5, PROFIT_TH[30])).toBe(10);
    expect(profitScore(3, PROFIT_TH[30])).toBe(7);
    expect(profitScore(0, PROFIT_TH[30])).toBe(5);
    expect(profitScore(-1, PROFIT_TH[30])).toBe(4);
    expect(profitScore(-10, PROFIT_TH[30])).toBe(1);
  });
  it("risk ratio", () => {
    expect(riskScore(20, 10)).toBe(10);
    expect(riskScore(1, 10)).toBe(2);
    expect(riskScore(-1, 10)).toBe(1);
  });
  it("consistency 90d", () => { expect(consistencyScore(85, CONS_TH[90])).toBe(10); expect(consistencyScore(5, CONS_TH[90])).toBe(1); });
  it("track record", () => { expect(trackScore(200)).toBe(10); expect(trackScore(100)).toBe(8); expect(trackScore(2)).toBe(1); });
});

describe("scoreWallet", () => {
  it("strong wallet is tier A", () => { const r = scoreWallet(good, 1000); expect(r.score).toBeGreaterThanOrEqual(8); expect(r.tier).toBe("A"); });
  it("fewer than 50 trades caps at 7 and fails eligibility", () => {
    const r = scoreWallet({ ...good, trades: 40 }, 1000); expect(r.score).toBeLessThanOrEqual(7); expect(r.tier).toBe(null);
  });
  it("negative lifetime pnl caps at 3", () => { expect(scoreWallet({ ...good, lifetime_pnl: -1 }, 1000).score).toBeLessThanOrEqual(3); });
  it("median hold under 24h is fast and not eligible", () => {
    const r = scoreWallet({ ...good, median_hold_h: 5 }, 1000); expect(r.fast).toBe(true); expect(r.eligible).toBe(false);
  });
  it("one liquidation fails the leverage filter", () => { expect(scoreWallet({ ...good, liquidations: 1 }, 1000).filters.leverage_liq).toBe(false); });
});

describe("fillsToTrades", () => {
  const f = (time: number, side: "B" | "A", sz: number, start: number, px: number, pnl = 0): Fill =>
    ({ coin: "BTC", px: String(px), sz: String(sz), side, time, startPosition: String(start), dir: "", closedPnl: String(pnl), fee: "1" });
  it("open, add, close = one trade", () => {
    const t = fillsToTrades([f(0, "B", 1, 0, 100), f(3600_000, "B", 1, 1, 110), f(7200_000, "A", 2, 2, 120, 30)]);
    expect(t).toHaveLength(1);
    expect(t[0].side).toBe("long");
    expect(t[0].net_pnl).toBe(27);
    expect(t[0].entry_px).toBe(105);
    expect(t[0].hold_h).toBe(2);
  });
  it("ignores trades opened before the window", () => { expect(fillsToTrades([f(0, "A", 1, 1, 100, 5)])).toHaveLength(0); });
});
