import { describe, it, expect } from "vitest";
import {
  sizeLive, liveEntryBlock, protectiveOrders, breakEvenStop, equityTrips, planReconcile, perpTransferUsd, liveEquityUsd,
  closeOrder, triggerOrder, newCloid, HARD, type LiveCfg, type AssetInfo, type LivePos,
} from "./live-risk";

const cfg: LiveCfg = {
  budget_sek: 600, usd_sek: 10, risk_pct: 1.5, max_risk_pct: 2, max_open: 2, min_order_usd: 10, fee_pct: 0.045, slip_pct: 0.05,
  daily_loss_pct: 3, weekly_loss_pct: 6, kill_drawdown_pct: 15, night_rule: true, kill_switch: false, live_armed: true,
  live_whitelist: ["BTC", "ETH", "SOL"], live_min_volume_usd: 10_000_000, max_entries_per_day: 6,
};
const BTC: AssetInfo = { coin: "BTC", asset: 0, szDecimals: 5, maxLeverage: 40 };
const SOL: AssetInfo = { coin: "SOL", asset: 5, szDecimals: 2, maxLeverage: 20 };
const ONDO: AssetInfo = { coin: "ONDO", asset: 120, szDecimals: 0, maxLeverage: 10 };
const noon = new Date("2026-10-09T10:00:00Z"); // 12:00 Stockholm

describe("liveEquityUsd", () => {
  it("never sizes from more than the budget", () => {
    expect(liveEquityUsd(cfg, 100)).toBe(60);
    expect(liveEquityUsd(cfg, 45)).toBe(45);
  });
});

describe("sizeLive", () => {
  it("sizes by risk, respects lots, leverage cap and the minimum order", () => {
    const z = sizeLive({ cfg, asset: SOL, side: "long", mark: 150, stop: 141, equityUsd: 60, usedMarginUsd: 0 });
    expect(z.ok).toBe(true);
    if (!z.ok) return;
    // risk 0.9 / stop distance ~6.05% ≈ $14.9 notional → 0.09 SOL (lot 0.01)
    expect(z.size).toBe("0.09");
    expect(z.notionalUsd).toBeCloseTo(13.5, 5);
    expect(z.notionalUsd).toBeGreaterThanOrEqual(cfg.min_order_usd);
    expect(z.leverage).toBe(3);
    expect(z.riskUsd).toBeLessThanOrEqual(60 * 0.02);
    expect(Number(z.limitPx)).toBeCloseTo(150.45, 2); // +0.3%
    expect(z.isBuy).toBe(true);
  });
  it("bumps up to the minimum order when risk-based size is too small", () => {
    const z = sizeLive({ cfg, asset: BTC, side: "long", mark: 100_000, stop: 98_000, equityUsd: 60, usedMarginUsd: 0 });
    expect(z.ok).toBe(true);
    if (!z.ok) return;
    expect(z.notionalUsd).toBeGreaterThanOrEqual(10 * HARD.minOrderCushion);
    expect(z.leverage).toBe(5);
  });
  it("rejects when the minimum order would risk more than max_risk_pct", () => {
    // ONDO-like 11.6% stop: $10.2 minimum risks ~2.0%+ of $60
    const z = sizeLive({ cfg, asset: ONDO, side: "long", mark: 0.4922, stop: 0.4352, equityUsd: 59.95, usedMarginUsd: 0 });
    expect(z.ok).toBe(false);
  });
  it("caps notional at 2.5x equity and $200", () => {
    const z = sizeLive({ cfg: { ...cfg, risk_pct: 2 }, asset: BTC, side: "short", mark: 100_000, stop: 100_100, equityUsd: 60, usedMarginUsd: 0 });
    expect(z.ok).toBe(true);
    if (!z.ok) return;
    expect(z.notionalUsd).toBeLessThanOrEqual(150 + 1e-9);
    expect(z.isBuy).toBe(false);
    expect(Number(z.limitPx)).toBeLessThan(100_000);
  });
  it("rejects a price beyond the stop and too little free margin", () => {
    expect(sizeLive({ cfg, asset: SOL, side: "long", mark: 140, stop: 141, equityUsd: 60, usedMarginUsd: 0 }).ok).toBe(false);
    expect(sizeLive({ cfg, asset: SOL, side: "long", mark: 150, stop: 141, equityUsd: 60, usedMarginUsd: 58 }).ok).toBe(false);
  });
});

describe("liveEntryBlock", () => {
  const base = { cfg, now: noon, coin: "SOL", side: "long" as const, mark: 150, ref_px: 150, stop_px: 141, day_volume_usd: null, open_live: 0, entries_today: 0, day_pnl_usd: 0, week_pnl_usd: 0, equity_usd: 60 };
  it("passes a clean entry", () => expect(liveEntryBlock(base)).toBeNull());
  it("blocks when not armed or kill switch on", () => {
    expect(liveEntryBlock({ ...base, cfg: { ...cfg, live_armed: false } })).toMatch(/not armed/);
    expect(liveEntryBlock({ ...base, cfg: { ...cfg, kill_switch: true } })).toMatch(/kill/);
  });
  it("blocks at night in Stockholm", () => expect(liveEntryBlock({ ...base, now: new Date("2026-10-09T02:00:00Z") })).toMatch(/night/));
  it("blocks illiquid coins not on the list", () => {
    expect(liveEntryBlock({ ...base, coin: "XYZ", day_volume_usd: 2_000_000 })).toMatch(/not on the live list/);
    expect(liveEntryBlock({ ...base, coin: "XYZ", day_volume_usd: 50_000_000 })).toBeNull();
  });
  it("blocks on counts and loss limits", () => {
    expect(liveEntryBlock({ ...base, open_live: 2 })).toMatch(/max open/);
    expect(liveEntryBlock({ ...base, entries_today: 6 })).toMatch(/entries today/);
    expect(liveEntryBlock({ ...base, day_pnl_usd: -1.8 })).toMatch(/daily loss/);
    expect(liveEntryBlock({ ...base, week_pnl_usd: -3.6 })).toMatch(/weekly loss/);
  });
  it("blocks when price ran more than 0.5R", () => expect(liveEntryBlock({ ...base, mark: 154.6 })).toMatch(/0.5R/));
});

describe("protective orders", () => {
  it("splits T1/T2 only when both halves clear the $10 minimum", () => {
    const o = protectiveOrders(SOL, "long", 0.14, 150, 144);
    expect(o.split).toBe(true);
    expect(o.sl.size).toBe("0.14");
    expect(o.sl.trigger?.tpsl).toBe("sl");
    expect(o.sl.isBuy).toBe(false);
    expect(o.t1?.size).toBe("0.07");
    expect(o.t2.size).toBe("0.07");
    expect(Number(o.t1?.trigger?.triggerPx)).toBeCloseTo(159, 1);
    expect(Number(o.t2.trigger?.triggerPx)).toBeCloseTo(168, 1);
    for (const x of [o.sl, o.t1!, o.t2]) expect(x.reduceOnly).toBe(true);
    expect(Number(o.sl.px)).toBeLessThan(144); // sell-stop limit below trigger
  });
  it("uses one full-size T2 when a half would be under the minimum", () => {
    const o = protectiveOrders(SOL, "long", 0.09, 150, 141);
    expect(o.split).toBe(false);
    expect(o.t1).toBeNull();
    expect(o.t2.size).toBe("0.09");
  });
  it("skips T1 when half rounds to zero lots", () => {
    const o = protectiveOrders(ONDO, "short", 1, 0.5, 0.55);
    expect(o.t1).toBeNull();
    expect(o.t2.size).toBe("1");
    expect(o.sl.isBuy).toBe(true);
    expect(Number(o.sl.px)).toBeGreaterThan(0.55);
  });
  it("break-even covers round-trip fees on the right side", () => {
    expect(breakEvenStop("long", 100, 0.045)).toBeCloseTo(100.09, 6);
    expect(breakEvenStop("short", 100, 0.045)).toBeCloseTo(99.91, 6);
  });
  it("close orders widen on retries", () => {
    expect(Number(closeOrder(SOL, "long", 0.09, 150, 0).px)).toBeCloseTo(148.5, 2);
    expect(Number(closeOrder(SOL, "long", 0.09, 150, 2).px)).toBeCloseTo(142.5, 2);
    expect(closeOrder(SOL, "short", 0.09, 150, 0).isBuy).toBe(true);
    expect(triggerOrder("sl", SOL, "short", 0.09, 160).isBuy).toBe(true);
  });
  it("cloid is 0x + 32 hex", () => expect(newCloid()).toMatch(/^0x[0-9a-f]{32}$/));
});

describe("equityTrips", () => {
  const base = { accountValueUsd: 60, startEquityUsd: 60, netTransfersUsd: 0, realizedUsd: 0, fundingUsd: 0, unrealizedUsd: 0, budgetUsd: 60, killDrawdownPct: 15 };
  it("clean when nothing changed", () => {
    const r = equityTrips(base);
    expect(r.drawdown).toBeNull();
    expect(r.mismatch).toBeNull();
  });
  it("drawdown trips at 15% of the budget basis", () => {
    expect(equityTrips({ ...base, accountValueUsd: 51.5, realizedUsd: -8.5 }).drawdown).toBeNull();
    expect(equityTrips({ ...base, accountValueUsd: 51, realizedUsd: -9 }).drawdown).not.toBeNull();
  });
  it("a deposit is neither profit nor a mismatch", () => {
    const r = equityTrips({ ...base, accountValueUsd: 160, netTransfersUsd: 100 });
    expect(r.drawdown).toBeNull();
    expect(r.mismatch).toBeNull();
  });
  it("unexplained change is a mismatch", () => {
    expect(equityTrips({ ...base, accountValueUsd: 56 }).mismatch).not.toBeNull();
  });
});

describe("planReconcile", () => {
  const pos: LivePos = {
    id: "p1", coin: "SOL", side: "long", setup: "pullback_long", status: "open", entry_t: "2026-10-09T10:50:00Z", entry_px: 150, size: 0.09,
    stop_px: 141, t1_px: 163.5, t2_px: 177, be_moved: false, t1_done: false, sl_oid: 11, t1_oid: 12, t2_oid: 13, close_reason: null,
  };
  const orders = [11, 12, 13].map((oid) => ({ oid, coin: "SOL", isTrigger: true, reduceOnly: true, sz: 0.05, triggerPx: 0, side: "A" as const }));
  const now = Date.parse("2026-10-10T10:00:00Z");
  const base = { now, positions: [pos], exch: [{ coin: "SOL", szi: 0.09, entryPx: 150, unrealizedPnl: 0 }], orders, mids: { SOL: 152 }, paperExits: {}, feePct: 0.045 };

  it("does nothing when all is in order", () => expect(planReconcile(base)).toEqual([]));
  it("marks closed and cancels leftovers when the exchange is flat", () => {
    expect(planReconcile({ ...base, exch: [], orders: orders.slice(1) })).toEqual([{ t: "closed", posId: "p1", cancel: [12, 13] }]);
  });
  it("detects a T1 fill and moves the stop to break-even", () => {
    const a = planReconcile({ ...base, exch: [{ coin: "SOL", szi: 0.05, entryPx: 150, unrealizedPnl: 1 }], orders: [orders[0], orders[2]], mids: { SOL: 164 } });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ t: "t1_filled", posId: "p1", newSize: 0.05, cancel: [11] });
    expect((a[0] as { beStop: number }).beStop).toBeCloseTo(150.135, 3);
  });
  it("restores a missing stop", () => {
    expect(planReconcile({ ...base, orders: orders.slice(1) })).toEqual([{ t: "restore_sl", posId: "p1", stop: 141, size: 0.09 }]);
  });
  it("moves to break-even by price when no T1 order exists", () => {
    const p = { ...pos, t1_oid: null };
    const a = planReconcile({ ...base, positions: [p], orders: [orders[0], orders[2]], mids: { SOL: 164 } });
    expect(a[0]).toMatchObject({ t: "move_be", posId: "p1", size: 0.09, cancel: [11] });
  });
  it("closes on the paper twin's time or follow exit and at max hold", () => {
    expect(planReconcile({ ...base, paperExits: { p1: "time_stop" } })[0]).toMatchObject({ t: "close", reason: "time_stop", size: 0.09, cancel: [11, 12, 13] });
    expect(planReconcile({ ...base, now: Date.parse("2026-10-24T11:00:00Z") })[0]).toMatchObject({ t: "close", reason: "max_hold" });
  });
  it("closes when price passed T2 without a resting T2 order", () => {
    expect(planReconcile({ ...base, orders: orders.slice(0, 2), mids: { SOL: 178 } })[0]).toMatchObject({ t: "close", reason: "t2_no_order" });
  });
  it("trips on unknown positions, wrong side and unexplained size changes", () => {
    expect(planReconcile({ ...base, exch: [...base.exch, { coin: "ETH", szi: 0.01, entryPx: 3000, unrealizedPnl: 0 }] })).toContainEqual({ t: "trip", reason: expect.stringMatching(/unknown long position on ETH/) });
    expect(planReconcile({ ...base, exch: [{ coin: "SOL", szi: -0.09, entryPx: 150, unrealizedPnl: 0 }] })[0].t).toBe("trip");
    expect(planReconcile({ ...base, exch: [{ coin: "SOL", szi: 0.2, entryPx: 150, unrealizedPnl: 0 }] })[0].t).toBe("trip");
    expect(planReconcile({ ...base, exch: [{ coin: "SOL", szi: 0.05, entryPx: 150, unrealizedPnl: 0 }] })[0].t).toBe("trip"); // T1 still resting
  });
  it("retries an unfinished close every run and restores a missing stop on it", () => {
    const closing = { ...pos, status: "closing" as const, close_reason: "protect_failed", sl_oid: null };
    const a = planReconcile({ ...base, positions: [closing], orders: [] });
    expect(a).toEqual([
      { t: "restore_sl", posId: "p1", stop: 141, size: 0.09 },
      { t: "close", posId: "p1", reason: "protect_failed", size: 0.09, cancel: [] },
    ]);
    expect(planReconcile({ ...base, positions: [closing], exch: [], orders: [] })).toEqual([{ t: "closed", posId: "p1", cancel: [] }]);
  });
  it("never cancels a reduce-only order on a coin that still has a position", () => {
    const ro = { oid: 77, coin: "ETH", isTrigger: true, reduceOnly: true, sz: 0.01, triggerPx: 2800, side: "A" as const };
    const a = planReconcile({ ...base, exch: [...base.exch, { coin: "ETH", szi: 0.01, entryPx: 3000, unrealizedPnl: 0 }], orders: [...orders, ro] });
    expect(a.some((x) => x.t === "cancel_orphan")).toBe(false);
    expect(a.some((x) => x.t === "trip")).toBe(true);
  });
  it("cancels orphan orders but leaves in-flight entries alone", () => {
    const orphan = { oid: 99, coin: "ETH", isTrigger: false, reduceOnly: false, sz: 1, triggerPx: 0, side: "B" as const };
    expect(planReconcile({ ...base, orders: [...orders, orphan] })).toContainEqual({ t: "cancel_orphan", oid: 99, coin: "ETH" });
    const opening = { ...pos, id: "p2", coin: "ETH", status: "opening" as const, sl_oid: null, t1_oid: null, t2_oid: null };
    expect(planReconcile({ ...base, positions: [pos, opening], orders: [...orders, orphan] })).toEqual([]);
  });
});

describe("perpTransferUsd", () => {
  const me = "0xAbC0000000000000000000000000000000000001";
  it("counts deposits, withdrawals and spot↔perp moves", () => {
    expect(perpTransferUsd({ type: "deposit", usdc: "60.0" }, me)).toBe(60);
    expect(perpTransferUsd({ type: "withdraw", usdc: "10", fee: "1" }, me)).toBe(-11);
    expect(perpTransferUsd({ type: "accountClassTransfer", usdc: "5", toPerp: false }, me)).toBe(-5);
    expect(perpTransferUsd({ type: "internalTransfer", usdc: "5", user: "0xother", destination: me.toLowerCase(), fee: "0" }, me)).toBe(5);
    expect(perpTransferUsd({ type: "vaultDeposit", usdc: "5" }, me)).toBe(-5);
    expect(perpTransferUsd({ type: "send", user: me, destination: me, sourceDex: "", destinationDex: "spot", usdcValue: "10", fee: "0" }, me)).toBe(-10);
    expect(perpTransferUsd({ type: "send", user: me, destination: me, sourceDex: "spot", destinationDex: "", usdcValue: "10", fee: "0" }, me)).toBe(10);
    expect(perpTransferUsd({ type: "liquidation" }, me)).toBe(0);
    expect(perpTransferUsd({ type: "somethingNew" }, me)).toBeNull();
  });
});
