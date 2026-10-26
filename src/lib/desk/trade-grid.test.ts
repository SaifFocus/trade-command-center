import { describe, it, expect } from "vitest";
import { classify, stats, sameHourClusters, groupTrades, traderLabel, type GridTrade } from "./trade-grid";

const t = (id: string, result: number, exitT = "2026-10-26T10:10:00Z", extra: Partial<GridTrade> = {}): GridTrade => ({
  id, coin: "BTC", side: "long", setup: "pullback_long", trader: null, exitT, exitReason: null, result, usd: null, ...extra,
});

describe("classify", () => {
  it("R thresholds", () => {
    expect(classify(0.5, "R")).toBe("big_win");
    expect(classify(0.49, "R")).toBe("win");
    expect(classify(0.05, "R")).toBe("win");
    expect(classify(0.049, "R")).toBe("flat");
    expect(classify(-0.049, "R")).toBe("flat");
    expect(classify(-0.49, "R")).toBe("loss");
    expect(classify(-0.5, "R")).toBe("big_loss");
  });
  it("% thresholds", () => {
    expect(classify(2, "%")).toBe("big_win");
    expect(classify(1.99, "%")).toBe("win");
    expect(classify(0.09, "%")).toBe("flat");
    expect(classify(-1.99, "%")).toBe("loss");
    expect(classify(-2, "%")).toBe("big_loss");
  });
});

describe("stats", () => {
  it("win rate counts flats as trades but not wins", () => {
    const s = stats([t("a", 1), t("b", 0.01), t("c", -0.5), t("d", 0.5)], "R");
    expect(s.trades).toBe(4);
    expect(s.winRate).toBe(50);
    expect(s.total).toBeCloseTo(1.01);
    expect(s.avg).toBeCloseTo(0.2525);
    expect(s.profitFactor).toBeCloseTo(1.51 / 0.5);
  });
  it("profit factor null without losses", () => {
    expect(stats([t("a", 1), t("b", 0.2)], "R").profitFactor).toBeNull();
  });
});

describe("sameHourClusters", () => {
  it("splits at a Stockholm hour boundary (CET, UTC+1 on 2026-10-26)", () => {
    // 10:59 UTC = 11:59 Stockholm; 11:00 UTC = 12:00 Stockholm; 11:30 UTC = 12:30
    const c = sameHourClusters([t("a", 1, "2026-10-26T10:59:00Z"), t("b", 1, "2026-10-26T11:00:00Z"), t("c", 1, "2026-10-26T11:30:00Z")]);
    expect(c.get("a")).toBe(0);
    expect(c.get("b")).toBe(1);
    expect(c.get("c")).toBe(1);
    expect(stats([t("a", 1, "2026-10-26T10:59:00Z"), t("b", 1, "2026-10-26T11:00:00Z"), t("c", 1, "2026-10-26T11:30:00Z")], "R").independent).toBe(2);
  });
});

describe("groupTrades", () => {
  it("sorts by total descending", () => {
    const g = groupTrades([t("a", -1, undefined, { coin: "ETH" }), t("b", 2, undefined, { coin: "SOL" }), t("c", 0.5, undefined, { coin: "BTC" })], "coin", "R");
    expect(g.map((x) => x.name)).toEqual(["SOL", "BTC", "ETH"]);
  });
  it("trader None for missing", () => {
    expect(groupTrades([t("a", 1)], "trader", "R")[0].name).toBe("None");
  });
});

describe("traderLabel", () => {
  it("formats", () => {
    expect(traderLabel("0x1234567890abcdef1234", "Whale · tier B")).toBe("Whale");
    expect(traderLabel("0x1234567890abcdef1234")).toBe("0x1234…1234");
    expect(traderLabel("invo:alice")).toBe("alice");
  });
});
