import { describe, expect, it } from "vitest";
import { liqPrice, sizePosition, walkBars, slipFor, type Bar, type WalkPos } from "./fx";

const base = { equity: 15, freeMargin: 15, entry: 1.1, stop: 1.09, riskPct: 10, maxRiskPct: 10, leverage: 20, maxLeverage: 20, coin: "xyz:EUR" };

describe("sizePosition", () => {
  it("sizes from risk when under the leverage cap", () => {
    const r = sizePosition(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.riskUsd).toBeCloseTo(1.5);
    expect(r.size).toBeCloseTo(150);
    expect(r.notional).toBeCloseTo(165);
    expect(r.capped).toBe(false);
    expect(r.margin).toBeCloseTo(8.25);
  });
  it("caps risk at the book's max risk %", () => {
    const r = sizePosition({ ...base, riskPct: 50 });
    expect(r.ok && r.riskUsd).toBeCloseTo(1.5);
  });
  it("caps notional at equity × leverage and shrinks risk", () => {
    const r = sizePosition({ ...base, leverage: 5, maxLeverage: 5 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.notional).toBeCloseTo(75);
    expect(r.riskUsd).toBeCloseTo((75 / 1.1) * 0.01);
    expect(r.capped).toBe(true);
  });
  it("uses the coin max leverage (20x for metals)", () => {
    const r = sizePosition({ ...base, coin: "xyz:GOLD", leverage: 50, maxLeverage: 50, stop: 1.0999 });
    expect(r.ok && r.leverage).toBe(20);
  });
  it("refuses below $10 notional", () => {
    const r = sizePosition({ ...base, equity: 15, riskPct: 1, maxRiskPct: 1, stop: 1.0 });
    expect(r.ok).toBe(false);
  });
  it("GBP slippage is at least 0.05%", () => {
    expect(slipFor("xyz:GBP", 0.02)).toBe(0.05);
    expect(slipFor("xyz:EUR", 0.02)).toBe(0.02);
  });
});

describe("liqPrice", () => {
  it("long at 10x with 1% maintenance", () => {
    // entry 100, size 1, margin 10 → (100 − 10) / 0.99
    expect(liqPrice("long", 100, 1, 10, 0.01)).toBeCloseTo(90.909, 3);
  });
  it("short at 10x with 1% maintenance", () => {
    expect(liqPrice("short", 100, 1, 10, 0.01)).toBeCloseTo(108.911, 3);
  });
  it("metals at 20x with 2.5% maintenance sit close to entry", () => {
    expect(liqPrice("long", 100, 1, 5, 0.025)).toBeCloseTo(97.436, 3);
  });
});

const H = 3_600_000;
const bar = (t: number, o: number, h: number, l: number, c: number): Bar => ({ t, o, h, l, c });
const long: WalkPos = { side: "long", size: 1, notional: 100, stop: 95, target: 110, liq: 91 };

describe("walkBars", () => {
  it("liquidation before stop when both are in one bar", () => {
    const r = walkBars(long, [bar(H + 60_000, 100, 101, 90, 92)], 0, 0.02);
    expect(r.exit).toEqual({ px: 91, reason: "liquidation", t: H + 60_000 });
  });
  it("stop before target in the same bar, with slippage", () => {
    const r = walkBars(long, [bar(H + 60_000, 100, 111, 94, 100)], 0, 0.02);
    expect(r.exit?.reason).toBe("stop");
    expect(r.exit?.px).toBeCloseTo(95 * (1 - 0.0002));
  });
  it("gap through the stop fills at the bar open", () => {
    const r = walkBars(long, [bar(H + 60_000, 93, 94, 92, 93)], 0, 0);
    expect(r.exit).toMatchObject({ px: 93, reason: "stop" });
  });
  it("short stop gap fills at the (higher) open with slippage", () => {
    const short: WalkPos = { side: "short", size: 1, notional: 100, stop: 105, target: 90, liq: 109 };
    const r = walkBars(short, [bar(H + 60_000, 106, 107, 105.5, 106)], 0, 0.02);
    expect(r.exit?.px).toBeCloseTo(106 * 1.0002);
  });
  it("target fills at target with slippage", () => {
    const r = walkBars(long, [bar(H + 60_000, 100, 111, 99, 110)], 0, 0.02);
    expect(r.exit).toMatchObject({ reason: "target" });
    expect(r.exit?.px).toBeCloseTo(110 * 0.9998);
  });
  it("funding: longs pay positive rates, shorts receive, only on hour bars", () => {
    const bars = [bar(H, 100, 100, 100, 100), bar(H + 60_000, 100, 100, 100, 100), bar(2 * H, 100, 100, 100, 100)];
    expect(walkBars(long, bars, 0.0001, 0).funding).toBeCloseTo(0.02);
    expect(walkBars({ ...long, side: "short", stop: 120, target: 80, liq: 130 }, bars, 0.0001, 0).funding).toBeCloseTo(-0.02);
    expect(walkBars(long, bars, 0, 0).checkedTo).toBe(2 * H + 60_000);
  });
  it("no exit leaves the position open", () => {
    expect(walkBars(long, [bar(H + 60_000, 100, 101, 99, 100)], 0, 0).exit).toBeNull();
  });
});
