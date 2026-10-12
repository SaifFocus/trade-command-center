import { describe, it, expect } from "vitest";
import { parseVisit, diffInvo, normalizeCoin, type Capture, type HeldRow } from "./invo-parse";

const PAPER = { portfolio_id: "2e40ca51-86b9-4bf8-b2eb-8ddd374d41dd", username: "traz" };
const LIVE = { portfolio_id: "49d44e95-6954-45ab-8277-9e9404971315", username: "bluespire" };

// Shapes as the Invo web app received them on 2026-10-12 (trimmed).
const inv = (id: string, ticker: string, long: boolean, px: number, created: string, extra: Record<string, unknown> = {}) => ({
  id, owner: { id: "u1", username: "traz", name: "7CASH" }, portfolio: { id: PAPER.portfolio_id, title: "ONE PIECE $$$" },
  name: ticker, ticker, directionLong: long, entryPrice: px, createdAt: created, customEntryDate: null, isOpen: true,
  closingPrice: null, leverage: 6, positionSize: 0.0097, changes: { entryPrice: px * 1.01, liquidationPrice: px * 0.9 }, ...extra,
});
const paperCaps = (items: unknown[], openPositions: number): Capture[] => [
  { url: "https://api.invoapp.com/v1_0/portfolios/get_portfolio_by_id", method: "POST", req: JSON.stringify({ portfolioId: PAPER.portfolio_id }),
    body: { portfolio: { id: PAPER.portfolio_id, type: "paper", openPositions, closedPositions: 111, owner: { username: "traz" } }, success: true } },
  { url: "https://api.invoapp.com/v1_0/investments/get_investments", method: "POST", req: JSON.stringify({ portfolioId: PAPER.portfolio_id, isOpen: true }),
    body: { error: null, investmentsTicker: items, success: true } },
  { url: "https://api.invoapp.com/analytics/portfolio/pnl/history", body: { status: "complete", items: [{ plSnapshot: 1, snapshotAt: "2026-10-01T00:00:00Z", equity: 100 }] } },
];
const livePos = (id: string, coin: string, side: string, px: string, opened: string) => ({
  id, assetSymbol: coin, side, leverage: 3, entryPx: px, markPx: px, exitPx: null, size: { pct: "0.42", cash: "2019" },
  openedAt: opened, closedAt: null, isOpen: true, pnl: { net: { pct: "-1.9", cash: "-40" } },
});
const liveCaps = (positions: unknown[], count: number, nextCursor: string | null = null): Capture[] => [
  { url: `https://api.invoapp.com/dex/portfolio/live/${LIVE.portfolio_id}/overview`, method: "GET",
    body: { success: true, data: { portfolioId: LIVE.portfolio_id, closedCount: 280, accuracyPct: 74.6, openTrades: { count, assets: [] } } } },
  { url: `https://api.invoapp.com/dex/portfolio/position/${LIVE.portfolio_id}/list?isOpen=true`, method: "GET",
    body: { success: true, data: { portfolioId: LIVE.portfolio_id, isOpen: true, positions, nextCursor } } },
  // Live portfolios also return the stale paper-style counters (always 0): the larger count wins.
  { url: "https://api.invoapp.com/v1_0/portfolios/get_portfolio_by_id", req: JSON.stringify({ portfolioId: LIVE.portfolio_id }),
    body: { portfolio: { id: LIVE.portfolio_id, type: "live", openPositions: 0 } } },
];

describe("parseVisit", () => {
  it("reads a paper portfolio: positions, declared count, completeness", () => {
    const v = parseVisit(PAPER, paperCaps([inv("a", "PUMP", true, 0.0051, "2026-10-12T14:49:00Z"), inv("b", "SOL", false, 107.2, "2026-10-11T09:00:00Z")], 2));
    expect(v.ok).toBe(true);
    expect(v.declared_open).toBe(2);
    expect(v.complete).toBe(true);
    expect(v.newest_first).toBe(true);
    expect(v.open.map((p) => [p.coin, p.side, p.entry_px])).toEqual([["PUMP", "long", 0.0051], ["SOL", "short", 107.2]]);
    expect(v.open[0].size_frac).toBeCloseTo(0.0097);
  });
  it("marks a first page of a longer list as incomplete", () => {
    const v = parseVisit(PAPER, paperCaps([inv("a", "PUMP", true, 0.0051, "2026-10-12T14:49:00Z")], 19));
    expect(v.complete).toBe(false);
    expect(v.declared_open).toBe(19);
  });
  it("reads a live portfolio and prefers the larger declared count", () => {
    const v = parseVisit(LIVE, liveCaps([livePos("x", "CASHCAT", "long", "0.10534", "2026-10-12T21:49:13.967Z"), livePos("y", "STRK", "short", "0.123", "2026-10-11T19:58:32Z")], 2));
    expect(v.declared_open).toBe(2);
    expect(v.complete).toBe(true);
    expect(v.open.map((p) => `${p.coin} ${p.side}`)).toEqual(["CASHCAT long", "STRK short"]);
    expect(v.open[0].size_frac).toBeCloseTo(0.0042);
  });
  it("ignores positions of other portfolios (feeds, suggestions)", () => {
    const other = { ...inv("z", "DOGE", true, 0.2, "2026-10-12T10:00:00Z"), owner: { username: "someoneelse" }, portfolio: { id: "other" } };
    const v = parseVisit(PAPER, [...paperCaps([inv("a", "PUMP", true, 0.0051, "2026-10-12T14:49:00Z")], 1), { url: "https://api.invoapp.com/v1_0/posts/get_feed", body: { posts: [{ investment: other }] } }]);
    expect(v.open.map((p) => p.coin)).toEqual(["PUMP"]);
    expect(v.notes.join(" ")).toMatch(/other portfolios/);
  });
  it("survives renamed fields and a moved endpoint", () => {
    const renamed = { uuid: "q1", symbol: "ETH", direction: "SHORT", avgEntryPrice: "2500.5", openTime: 1791800000000, open: true };
    const v = parseVisit(LIVE, [
      { url: "https://api2.invoapp.com/v9/trader/positions", req: JSON.stringify({ portfolio: LIVE.portfolio_id }), body: { result: { portfolioId: LIVE.portfolio_id, openCount: 1, rows: [renamed] } } },
    ]);
    expect(v.ok).toBe(true);
    expect(v.complete).toBe(true);
    expect(v.open[0]).toMatchObject({ key: "q1", coin: "ETH", side: "short", entry_px: 2500.5 });
  });
  it("reports nothing understood when the captures hold no positions or counts (e.g. logged out)", () => {
    const v = parseVisit(PAPER, [{ url: "https://api.invoapp.com/v1_0/auth/refresh_token", status: 401, body: { message: "Unauthorized" } }]);
    expect(v.ok).toBe(false);
  });
  it("collects positions the captures show as closed", () => {
    const closed = { ...livePos("c", "NEAR", "short", "5.83", "2026-10-10T10:00:00Z"), isOpen: false, exitPx: "5.1", closedAt: "2026-10-12T08:00:00Z" };
    const v = parseVisit(LIVE, liveCaps([closed], 0));
    expect(v.open).toEqual([]);
    expect(v.closed.map((c) => c.coin)).toEqual(["NEAR"]);
  });
});

describe("diffInvo", () => {
  const uni = new Set(["PUMP", "SOL", "NEAR", "STRK", "kPEPE", "BTC"]);
  const map = (c: string) => normalizeCoin(c, uni);
  const held = (coin: string, side: "long" | "short", opened: string): HeldRow => ({ coin, side, entry_px: 1, opened_at: opened });

  it("opens new coins and records them; a first look is a silent baseline", () => {
    const v = parseVisit(PAPER, paperCaps([inv("a", "PUMP", true, 0.0051, "2026-10-12T14:49:00Z")], 1));
    expect(diffInvo([], v, map, false).events).toEqual([{ kind: "open", coin: "PUMP", side: "long", entry_px: 0.0051, leverage: 6, size_frac: 0.0097 }]);
    const b = diffInvo([], v, map, true);
    expect(b.events).toEqual([]);
    expect(b.upserts.map((u) => u.coin)).toEqual(["PUMP"]);
  });
  it("closes on a complete list, and a side flip is close + open", () => {
    const v = parseVisit(LIVE, liveCaps([livePos("y", "STRK", "long", "0.1", "2026-10-12T19:58:32Z")], 1));
    const d = diffInvo([held("NEAR", "short", "2026-10-11T00:00:00Z"), held("STRK", "short", "2026-10-10T00:00:00Z")], v, map, false);
    expect(d.events.map((e) => `${e.kind} ${e.coin} ${e.side}`).sort()).toEqual(["close NEAR short", "close STRK short", "open STRK long"]);
    expect(d.deletes).toEqual(["NEAR"]);
  });
  it("never closes a held position that a partial page simply does not show", () => {
    const v = parseVisit(PAPER, paperCaps([inv("a", "PUMP", true, 0.0051, "2026-10-12T14:49:00Z"), inv("b", "SOL", false, 107, "2026-10-12T09:00:00Z")], 19));
    const d = diffInvo([held("BTC", "long", "2026-10-01T00:00:00Z")], v, map, false);
    expect(d.events.filter((e) => e.kind === "close")).toEqual([]);
    expect(d.unknown).toEqual(["BTC"]);
  });
  it("closes a missing position newer than the oldest one on a newest-first page", () => {
    const v = parseVisit(PAPER, paperCaps([inv("a", "PUMP", true, 0.0051, "2026-10-12T14:49:00Z"), inv("b", "SOL", false, 107, "2026-10-12T09:00:00Z")], 19));
    const d = diffInvo([held("BTC", "long", "2026-10-12T10:00:00Z")], v, map, false);
    expect(d.events).toContainEqual(expect.objectContaining({ kind: "close", coin: "BTC" }));
  });
  it("does not infer closes from a page that is not newest-first", () => {
    const v = parseVisit(PAPER, paperCaps([inv("b", "SOL", false, 107, "2026-10-12T09:00:00Z"), inv("a", "PUMP", true, 0.0051, "2026-10-12T14:49:00Z")], 19));
    expect(v.newest_first).toBe(false);
    expect(diffInvo([held("BTC", "long", "2026-10-12T10:00:00Z")], v, map, false).unknown).toEqual(["BTC"]);
  });
  it("closes when the captures show the held position closed", () => {
    const closed = { ...livePos("c", "NEAR", "short", "5.83", "2026-10-10T10:00:00Z"), isOpen: false, exitPx: "5.1", closedAt: "2026-10-12T08:00:00Z" };
    const v = parseVisit(LIVE, [liveCaps([], 5)[0], { url: "x", req: LIVE.portfolio_id, body: { data: { positions: [closed] } } }]);
    const d = diffInvo([held("NEAR", "short", "2026-10-10T10:00:00Z")], v, map, false);
    expect(d.events).toEqual([expect.objectContaining({ kind: "close", coin: "NEAR" })]);
  });
  it("skips coins Hyperliquid does not list and maps Invo names to Hyperliquid's", () => {
    expect(normalizeCoin("PEPE", uni)).toBe("kPEPE");
    expect(normalizeCoin("btc-usd", uni)).toBe("BTC");
    expect(normalizeCoin("AAPL", uni)).toBeNull();
    const v = parseVisit(PAPER, paperCaps([inv("a", "AAPL", true, 200, "2026-10-12T14:49:00Z")], 1));
    expect(diffInvo([], v, map, false).events).toEqual([]);
  });
});
