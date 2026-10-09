import { describe, it, expect } from "vitest";
import { pickMimic, mimicEntry, mimicExit, MIMIC, type MimicCandidate } from "./mimic";

const NOW = Date.UTC(2026, 9, 10);
const c = (over: Partial<MimicCandidate>): MimicCandidate => ({
  address: "0xa", sources: ["invo"], score: 3, trades: 100, profit_factor: 1.5, ret_30: 5, ret_90: 10, last_trade_at: NOW - 3600_000, liquid_share: 80, ...over,
});

describe("pickMimic", () => {
  it("keeps active, profitable Invo traders, best score first", () => {
    const picked = pickMimic([
      c({ address: "low", score: 2 }),
      c({ address: "high", score: 5 }),
      c({ address: "lb", sources: ["leaderboard"] }),
      c({ address: "stale", last_trade_at: NOW - 5 * 86400_000 }),
      c({ address: "losing", ret_30: -1, ret_90: -2 }),
      c({ address: "thin", trades: 5 }),
      c({ address: "pf", profit_factor: 1.1 }),
      c({ address: "illiquid", liquid_share: 20 }),
    ], NOW);
    expect(picked).toEqual(["high", "low"]);
  });
  it("respects the slot limit", () => {
    expect(pickMimic(Array.from({ length: 15 }, (_, i) => c({ address: `w${i}` })), NOW).length).toBe(MIMIC.slots);
  });
});

describe("mimic P&L", () => {
  it("charges slippage and Invo fees on both sides", () => {
    const e = mimicEntry(100, "long");
    expect(e.entry).toBeCloseTo(100.05, 6);
    const x = mimicExit({ side: "long", entry_px: e.entry, fees_usd: e.fees, notional_usd: 100 }, 100);
    expect(x.net).toBeLessThan(0); // flat price still loses the costs
    expect(x.net).toBeCloseTo(-(0.0768 * 2 + 0.1) , 1);
  });
  it("profits on a short when price falls", () => {
    const e = mimicEntry(100, "short");
    const x = mimicExit({ side: "short", entry_px: e.entry, fees_usd: e.fees, notional_usd: 100 }, 95);
    expect(x.pct).toBeGreaterThan(4.5);
  });
});
