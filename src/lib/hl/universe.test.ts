import { describe, it, expect } from "vitest";
import { baseCoins, candidateCoins, deskCoins, universeDecision, type CoinStats, type GroupStats } from "./universe";

const rows = Array.from({ length: 50 }, (_, i) => ({ coin: `C${i + 1}`, day_ntl_vlm: 1e9 / (i + 1) }));

describe("universe sets", () => {
  it("base is the top 20 plus listed always-on coins", () => {
    const b = baseCoins(rows, ["C35", "NOPE"]);
    expect(b.length).toBe(21);
    expect(b).toContain("C1");
    expect(b).toContain("C20");
    expect(b).toContain("C35");
    expect(b).not.toContain("NOPE");
  });
  it("candidates are ranks 21–40 minus base coins", () => {
    const c = candidateCoins(rows, ["C35"]);
    expect(c[0]).toBe("C21");
    expect(c).not.toContain("C35");
    expect(c).not.toContain("C41");
    expect(c.length).toBe(19);
  });
  it("desk coins add validated extras", () => {
    expect(deskCoins(rows, [], ["C30"])).toContain("C30");
    expect(deskCoins(rows, [], [])).not.toContain("C30");
  });
});

describe("universeDecision", () => {
  const good: GroupStats = { trades: 120, expectancy_in: 0.05, expectancy_out: 0.03, profit_factor: 1.1, max_drawdown_pct: 15 };
  const coin = (over: Partial<CoinStats>): CoinStats => ({ coin: "X", trades: 10, expectancy_r: 0.1, history_days: 400, day_ntl_vlm: 1e7, ...over });
  it("adds the group when it holds up, excluding only clear problems", () => {
    const d = universeDecision(good, [
      coin({ coin: "A" }),
      coin({ coin: "B", history_days: 90 }),
      coin({ coin: "C", day_ntl_vlm: 1e6 }),
      coin({ coin: "D", trades: 9, expectancy_r: -0.6 }),
      coin({ coin: "E", trades: 5, expectancy_r: -0.9 }),
    ]);
    expect(d.pass).toBe(true);
    expect(d.add).toEqual(["A", "E"]);
    expect(d.excluded.map((e) => e.coin)).toEqual(["B", "C", "D"]);
  });
  it("adds nothing when the group fails out of sample", () => {
    const d = universeDecision({ ...good, expectancy_out: -0.02 }, [coin({ coin: "A" })]);
    expect(d.pass).toBe(false);
    expect(d.add).toEqual([]);
    expect(d.reasons.join(" ")).toContain("last 40%");
  });
  it("needs enough trades", () => {
    expect(universeDecision({ ...good, trades: 12 }, [coin({})]).pass).toBe(false);
  });
});
