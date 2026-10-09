// End-to-end simulations of the live desk against a simulated exchange and an in-memory database.
// The fake enforces Hyperliquid's $10 minimum (except reduce-only orders that close the whole position).
import { describe, it, expect, beforeEach } from "vitest";
import { FakeDB, FakeExchange } from "./testing/fakes";
import { executeLive, reconcileLive, killLive, smokeTest, armLive, liveStatus } from "./live.server";

const cfgRow = (over: Record<string, unknown> = {}) => ({
  id: 1, budget_sek: 600, usd_sek: 10, risk_pct: 1.5, max_risk_pct: 2, max_open: 2, min_order_usd: 10, fee_pct: 0.045, slip_pct: 0.05,
  daily_loss_pct: 3, weekly_loss_pct: 6, kill_drawdown_pct: 15, night_rule: false, kill_switch: false, mode: "live",
  live_armed: true, live_armed_at: new Date(Date.now() - 3600_000).toISOString(), live_start_equity_usd: 60,
  live_whitelist: ["BTC", "ETH", "SOL"], live_min_volume_usd: 1e7, max_entries_per_day: 6, live_trip_streak: 0, ...over,
});
const wide = { id: "sig-1", coin: "SOL", side: "long", setup: "pullback_long", ref_px: 150, stop_px: 141 }; // 6% stop → ~$13.5, no split
const tight = { ...wide, id: "sig-2", stop_px: 144 }; // 4% stop → ~$21, T1/T2 split

let db: FakeDB;
let ex: FakeExchange;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const D = () => db as any;
const pos = () => db.t("live_positions")[0];
const cfg = () => db.t("desk_config")[0];
const kinds = () => [...ex.orders.values()].map((o) => `${o.kind}:${o.size}@${o.trigger?.triggerPx}`);

beforeEach(() => {
  db = new FakeDB({ desk_config: [cfgRow()], signals: [{ ...wide, status: "executed" }, { ...tight, status: "executed" }], paper_positions: [] });
  ex = new FakeExchange();
});

describe("live lifecycle", () => {
  it("splits T1/T2 when both halves clear $10, books half at T1, moves to break-even and books the rest", async () => {
    const r = await executeLive(D(), tight, { ex });
    expect(r.status).toBe("filled");
    expect(ex.pos.get("SOL")?.szi).toBe(0.14);
    expect(kinds()).toEqual(["sl:0.14@144", "t1:0.07@159", "t2:0.07@168"]);
    expect((await reconcileLive(D(), { ex })).actions).toEqual([]);

    ex.tick("SOL", 160); // T1 fires
    expect((await reconcileLive(D(), { ex })).actions).toEqual(["t1_filled"]);
    expect(pos().be_moved).toBe(true);
    expect(pos().size).toBe(0.07);
    expect(kinds()).toEqual(["t2:0.07@168", "sl:0.07@150.13"]);

    ex.tick("SOL", 150); // break-even stop fires
    expect((await reconcileLive(D(), { ex })).actions).toEqual(["closed"]);
    expect(pos().status).toBe("closed");
    expect(pos().close_reason).toBe("breakeven");
    expect(pos().net_usd).toBeGreaterThan(0.6);
    expect(pos().net_usd).toBeLessThan(0.64);
    expect(ex.orders.size).toBe(0);
    expect(cfg().kill_switch).toBe(false);
  });

  it("small positions get one full-size T2 and a price-based break-even at T1", async () => {
    await executeLive(D(), wide, { ex });
    expect(kinds()).toEqual(["sl:0.09@141", "t2:0.09@177"]);
    ex.tick("SOL", 164);
    expect((await reconcileLive(D(), { ex })).actions).toEqual(["move_be"]);
    expect(pos().be_moved).toBe(true);
    ex.tick("SOL", 177);
    await reconcileLive(D(), { ex });
    expect(pos().close_reason).toBe("t2");
    expect(pos().net_usd).toBeCloseTo(0.09 * 27 - 0.0115, 2);
  });

  it("a stop-out closes and records a loss near 1R", async () => {
    await executeLive(D(), wide, { ex });
    ex.tick("SOL", 140);
    await reconcileLive(D(), { ex });
    expect(pos().close_reason).toBe("stop");
    expect(pos().net_usd).toBeCloseTo(-(0.09 * 9) - 0.0115, 2);
  });

  it("skips entries the rules block and records why", async () => {
    db.t("desk_config")[0].live_armed = false;
    expect((await executeLive(D(), wide, { ex })).status).toBe("skipped");
    db.t("desk_config")[0].live_armed = true;
    ex.px.SOL = 155; // ran > 0.5R
    expect((await executeLive(D(), wide, { ex })).note).toMatch(/0.5R/);
    expect(ex.pos.size).toBe(0);
  });

  it("falls back to a full-size T2 when the exchange rejects T1", async () => {
    ex.rejectHalfT1 = true;
    await executeLive(D(), tight, { ex });
    expect(pos().t1_oid).toBeNull();
    expect(kinds()).toEqual(["sl:0.14@144", "t2:0.14@168"]);
  });

  it("refuses a second position on the same coin", async () => {
    await executeLive(D(), wide, { ex });
    expect((await executeLive(D(), tight, { ex })).status).toBe("skipped");
    expect(ex.pos.get("SOL")?.szi).toBe(0.09);
  });
});

describe("never unprotected", () => {
  it("a rejected stop closes the trade at once", async () => {
    ex.rejectTriggers = true;
    expect((await executeLive(D(), wide, { ex })).status).toBe("error");
    expect(ex.pos.get("SOL")?.szi).toBe(0);
    await reconcileLive(D(), { ex });
    expect(pos().status).toBe("closed");
    expect(pos().close_reason).toBe("protect_failed");
  });

  it("if the stop AND the close fail, reconcile puts a stop back and keeps retrying the close", async () => {
    ex.rejectTriggers = true;
    ex.rejectCloses = true;
    await executeLive(D(), wide, { ex });
    expect(pos().status).toBe("closing");
    expect(ex.pos.get("SOL")?.szi).toBe(0.09);

    ex.rejectTriggers = false; // stops work again, closes still fail
    await reconcileLive(D(), { ex });
    expect(kinds()).toEqual(["sl:0.09@141"]);
    expect(pos().close_attempts).toBe(1);

    ex.rejectCloses = false;
    await reconcileLive(D(), { ex });
    expect(ex.pos.get("SOL")?.szi).toBe(0);
    await reconcileLive(D(), { ex });
    expect(pos().status).toBe("closed");
    expect(ex.orders.size).toBe(0);
  });

  it("a close that keeps failing becomes a safety trip", async () => {
    ex.rejectTriggers = true;
    ex.rejectCloses = true;
    await executeLive(D(), wide, { ex });
    for (let i = 0; i < 3; i++) await reconcileLive(D(), { ex });
    expect(cfg().live_trip_streak).toBeGreaterThanOrEqual(1);
  });

  it("reconcile stands aside while another live job holds the lease", async () => {
    await executeLive(D(), wide, { ex });
    await db.rpc("live_lock", { p_owner: "execute:other", p_seconds: 120 });
    expect((await reconcileLive(D(), { ex })).skipped).toMatch(/another live job/);
  });
});

describe("safety", () => {
  it("kill switch closes everything, then cancels, and returns to paper", async () => {
    await executeLive(D(), wide, { ex });
    db.t("desk_config")[0].kill_switch = true; // e.g. set by the watchdog with SQL
    await reconcileLive(D(), { ex });
    expect(ex.pos.get("SOL")?.szi).toBe(0);
    expect(ex.orders.size).toBe(0);
    expect(cfg().mode).toBe("paper");
    expect(cfg().live_armed).toBe(false);
    expect(pos().status).toBe("closed");
    expect(pos().close_reason).toBe("kill");
  });

  it("kill survives partial fills without size drift", async () => {
    await executeLive(D(), wide, { ex });
    ex.partialCloseOnce = 0.05;
    const r = await killLive(D(), "test", { ex });
    expect(r.errors).toEqual([]);
    expect(ex.pos.get("SOL")?.szi).toBe(0);
  });

  it("keeps killing positions APEX does not track while the kill switch is on", async () => {
    db.t("desk_config")[0].kill_switch = true;
    db.t("desk_config")[0].live_armed = false;
    ex.pos.set("ETH", { szi: 0.01, entryPx: 3000 });
    ex.px.ETH = 3000;
    await reconcileLive(D(), { ex });
    expect(ex.pos.get("ETH")?.szi).toBe(0);
  });

  it("an unknown position trips the kill switch on the third failed check", async () => {
    await executeLive(D(), wide, { ex });
    ex.pos.set("ETH", { szi: 0.01, entryPx: 3000 });
    await reconcileLive(D(), { ex });
    await reconcileLive(D(), { ex });
    expect(cfg().kill_switch).toBe(false);
    expect(cfg().live_trip_streak).toBe(2);
    await reconcileLive(D(), { ex });
    expect(cfg().kill_switch).toBe(true);
    expect(ex.pos.get("ETH")?.szi).toBe(0);
    expect(ex.pos.get("SOL")?.szi).toBe(0);
  });

  it("a 15% loss trips the kill switch immediately", async () => {
    await executeLive(D(), wide, { ex });
    ex.cash -= 9.5;
    await reconcileLive(D(), { ex });
    expect(cfg().kill_switch).toBe(true);
    expect(cfg().live_trip_reason).toMatch(/drawdown/);
  });

  it("moving money to spot is not a loss", async () => {
    await executeLive(D(), wide, { ex });
    ex.cash -= 20;
    ex.transfers.push({ time: Date.now() - 1000, delta: { type: "send", user: ex.account, destination: ex.account, sourceDex: "", destinationDex: "spot", token: "USDC", usdcValue: "20", fee: "0" } });
    await reconcileLive(D(), { ex });
    await reconcileLive(D(), { ex });
    await reconcileLive(D(), { ex });
    expect(cfg().kill_switch).toBe(false);
    expect(cfg().live_trip_streak).toBe(0);
  });

  it("an unrecognised ledger entry pauses the equity check instead of killing", async () => {
    await executeLive(D(), wide, { ex });
    ex.cash -= 20;
    ex.transfers.push({ time: Date.now() - 1000, delta: { type: "somethingNew", usdc: "20" } });
    await reconcileLive(D(), { ex });
    expect(cfg().kill_switch).toBe(false);
    expect(db.logs().some((l) => /Equity check paused/.test(l))).toBe(true);
  });

  it("cancels stray non-reduce-only orders", async () => {
    ex.orders.set(999, { kind: "entry", coin: "ETH", asset: 1, isBuy: true, px: "2900", size: "0.01", reduceOnly: false, tif: "Gtc", oid: 999 });
    await executeLive(D(), wide, { ex });
    expect((await reconcileLive(D(), { ex })).actions).toContain("cancel_orphan");
    expect(ex.orders.has(999)).toBe(false);
  });
});

describe("smoke test and arming", () => {
  beforeEach(() => {
    db = new FakeDB({ desk_config: [cfgRow({ live_armed: false, mode: "paper", live_armed_at: null, live_start_equity_usd: null })] });
    ex = new FakeExchange();
  });
  it("smoke test opens, protects and closes ~$11 of BTC", async () => {
    const r = await smokeTest(D(), { ex });
    expect(r.passed).toBe(true);
    expect(ex.pos.get("BTC")?.szi).toBe(0);
    expect(ex.orders.size).toBe(0);
    expect(cfg().smoke_test_passed_at).toBeTruthy();
    expect(db.t("live_orders").map((o) => o.kind)).toEqual(["smoke_open", "smoke_sl", "close"]);
  });
  it("a smoke test whose close fails leaves the stop in place", async () => {
    ex.rejectCloses = true;
    const r = await smokeTest(D(), { ex });
    expect(r.passed).toBe(false);
    expect([...ex.orders.values()].some((o) => o.kind === "smoke_sl")).toBe(true);
  });
  it("arming needs the exact phrase and a passed smoke test", async () => {
    await expect(armLive(D(), "go live", { ex })).rejects.toThrow(/GO LIVE/);
    await expect(armLive(D(), "GO LIVE", { ex })).rejects.toThrow(/smoke test/);
    await smokeTest(D(), { ex });
    expect((await liveStatus(D(), { ex })).blockers).toEqual([]);
    const a = await armLive(D(), "GO LIVE", { ex });
    expect(a.armed).toBe(true);
    expect(cfg().mode).toBe("live");
    expect(cfg().live_start_equity_usd).toBeCloseTo(60, 1);
  });
});
