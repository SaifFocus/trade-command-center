import { describe, it, expect } from "vitest";
import { walkForwardMonths, simulateFollow, applyConcurrency, copySummary, runCopyBacktest, DEFAULT_COPY_PARAMS, type CoinHourly, type CopySignal, type CopyTrade, type CopyWallet } from "./copy-engine";
import type { Bar } from "@/lib/hl/engine";

const H1 = 3600_000, D1 = 86400_000;
const T0 = Date.UTC(2026, 3, 1); // 1 Apr 2026

/** Flat market at 100 with a daily range of 4 (daily ATR = 4, so R = 6), then whatever `path` says hourly. */
function coin(path: (i: number) => number, hours = 24 * 60): CoinHourly {
  const c1d: Bar[] = Array.from({ length: 40 }, (_, d) => ({ t: T0 - (40 - d) * D1, o: 100, h: 102, l: 98, c: 100, v: 0 }));
  const c1h: Bar[] = Array.from({ length: hours }, (_, i) => {
    const o = path(i), c = path(i + 1);
    return { t: T0 + i * H1, o, h: Math.max(o, c) + 0.1, l: Math.min(o, c) - 0.1, c, v: 0 };
  });
  return { coin: "SOL", c1h, c1d, f1h: new Map() };
}
const sig = (over: Partial<CopySignal> = {}): CopySignal => ({
  variant: "tier_a", coin: "SOL", side: "long", t: T0, theirEntryPx: 100, theirExitT: T0 + 30 * D1, wallets: ["0xa"], source: "leaderboard", ...over,
});

describe("walk-forward months", () => {
  it("starts on the first month boundary after 90 days of data", () => {
    const m = walkForwardMonths(Date.UTC(2026, 0, 15), Date.UTC(2026, 8, 10)).map((t) => new Date(t).toISOString().slice(0, 7));
    expect(m).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  });
});

describe("simulateFollow", () => {
  it("enters one hour after their fill and reaches T2 with half booked at T1", () => {
    const d = coin((i) => 100 + i * 0.25); // steady climb: +6 (1R) every 24 h
    const t = simulateFollow(sig(), d, DEFAULT_COPY_PARAMS, Infinity)!;
    expect(t.entry_t).toBe(T0 + H1);
    expect(t.entry_px).toBeCloseTo(100.25, 6);
    expect(t.stop_px).toBeCloseTo(94.25, 6);
    expect(t.exit_reason).toBe("t2");
    expect(t.gross_r).toBeCloseTo(0.5 * 1.5 + 0.5 * 3, 6);
    expect(t.net_r).toBeLessThan(t.gross_r);
  });
  it("stops out at -1R and charges costs", () => {
    const d = coin((i) => 100 - i * 0.25);
    const t = simulateFollow(sig(), d, DEFAULT_COPY_PARAMS, Infinity)!;
    expect(t.exit_reason).toBe("stop");
    expect(t.net_r).toBeLessThan(-1);
    expect(t.net_r).toBeGreaterThan(-1.05);
  });
  it("exits at the next hourly open after the followed wallet closes", () => {
    const d = coin(() => 100);
    const t = simulateFollow(sig({ theirExitT: T0 + 5 * H1 + 1 }), d, DEFAULT_COPY_PARAMS, Infinity)!;
    expect(t.exit_reason).toBe("follow_exit");
    expect(t.exit_t).toBe(T0 + 6 * H1);
  });
  it("skips when price already ran more than 0.5R their way", () => {
    const d = coin(() => 104); // their entry 100, R = 6, 4 > 3
    expect(simulateFollow(sig(), d, DEFAULT_COPY_PARAMS, Infinity)).toBeNull();
  });
  it("honours the 14-day max hold", () => {
    const d = coin(() => 100, 24 * 20);
    const t = simulateFollow(sig(), d, DEFAULT_COPY_PARAMS, Infinity)!;
    expect(t.exit_reason).toBe("max_hold");
    expect(t.exit_t - t.entry_t).toBe(14 * D1);
  });
});

describe("concurrency and summary", () => {
  const tr = (coin: string, a: number, b: number, r: number): CopyTrade => ({
    coin, setup: "pullback_long", side: "long", sample: a < 50 ? "in" : "out", entry_t: a, entry_px: 1, stop_px: 0.9, t1_px: 1.15, t2_px: 1.3,
    exit_t: b, exit_px: 1, exit_reason: "x", gross_r: r, fee_r: 0, funding_r: 0, net_r: r, bars_held: 1, variant: "tier_a", source: "leaderboard", wallets: [], month: "2026-05",
  });
  it("keeps at most two open copies and one per coin", () => {
    const kept = applyConcurrency([tr("A", 0, 10, 1), tr("B", 1, 10, 1), tr("C", 2, 10, 1), tr("A", 3, 10, 1), tr("C", 11, 20, 1)], 2);
    expect(kept.map((k) => `${k.coin}@${k.entry_t}`)).toEqual(["A@0", "B@1", "C@11"]);
  });
  it("gate needs 60 trades and positive expectancy in both halves", () => {
    const many = Array.from({ length: 70 }, (_, i) => tr(`C${i}`, i * 2, i * 2 + 1, i % 3 === 0 ? -1 : 1));
    expect(copySummary(many, DEFAULT_COPY_PARAMS).gate.pass).toBe(true);
    expect(copySummary(many.slice(0, 30), DEFAULT_COPY_PARAMS).gate.trades_ge_60).toBe(false);
  });
});

describe("runCopyBacktest", () => {
  it("runs end to end on synthetic wallets without errors", () => {
    const w: CopyWallet = {
      address: "0xa", sources: ["leaderboard"], firstSeen: T0 - 200 * D1,
      trades: Array.from({ length: 150 }, (_, i) => ({
        coin: "SOL", side: "long" as const, entry_t: T0 - 150 * D1 + i * D1, exit_t: T0 - 150 * D1 + i * D1 + 2 * D1,
        entry_px: 100, exit_px: i % 4 === 0 ? 97 : 104, max_notional: 2000, net_pnl: i % 4 === 0 ? -60 : 80, fees: 2, hold_h: 48, liquidated: false,
      })),
      portfolio: {
        av: Array.from({ length: 220 }, (_, d) => [T0 - 200 * D1 + d * D1, 10_000 + d * 40] as [number, number]),
        pnl: Array.from({ length: 220 }, (_, d) => [T0 - 200 * D1 + d * D1, d * 40] as [number, number]),
      },
    };
    const res = runCopyBacktest([w], new Map([["SOL", coin((i) => 100 + Math.sin(i / 10))]]), new Set(["SOL"]), T0 + 59 * D1);
    expect(Array.isArray(res.trades)).toBe(true);
    expect(res.months.length).toBeGreaterThan(0);
    expect(Object.keys(res.variants).sort()).toEqual(["consensus", "tier_a"]);
  });
});
