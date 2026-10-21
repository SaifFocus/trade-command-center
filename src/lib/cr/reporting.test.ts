import { describe, expect, it } from "vitest";
import { earningsReport, estimatedNet, isEarning, type ReportingPost } from "./reporting";

const now = Date.parse("2026-10-21T03:13:00Z");
const post = (overrides: Partial<ReportingPost> = {}): ReportingPost => ({
  submission_status: "approved", views_current: 10_000, est_earnings_usd: 0, paid_usd: 0,
  earning_window_ends_at: "2026-10-22T00:00:00Z", payout_eta: null,
  cr_clips: { cr_campaigns: { rate_per_1k_usd: 3, min_payout_usd: 6, max_payout_usd: 3000, flat_fee_usd: null } },
  ...overrides,
});

describe("USD reporting", () => {
  it("uses the campaign CPM and 10% fee for estimates", () => {
    expect(estimatedNet(post())).toBe(27);
  });
  it("does not deduct the fee again from a stored net estimate", () => {
    expect(estimatedNet(post({ est_earnings_usd: 20 }))).toBe(20);
  });
  it("excludes denied estimates but retains recorded payments", () => {
    const r = earningsReport([post({ submission_status: "denied", paid_usd: 5 })], now);
    expect(r.pending).toBe(0);
    expect(r.paid).toBe(5);
  });
  it("subtracts settled payouts without negative pending balances", () => {
    expect(earningsReport([post({ paid_usd: 7 }), post({ paid_usd: 30 })], now).pending).toBe(20);
  });
  it("does not treat observed views or approved submissions as verified views", () => {
    const r = earningsReport([post()], now);
    expect(r.observedViews).toBe(10_000);
    expect(r.verifiedViews).toBeNull();
  });
  it("counts only non-denied posts strictly before a known deadline", () => {
    expect(isEarning(post(), now)).toBe(true);
    expect(isEarning(post({ submission_status: "denied" }), now)).toBe(false);
    expect(isEarning(post({ earning_window_ends_at: new Date(now).toISOString() }), now)).toBe(false);
    expect(earningsReport([post({ earning_window_ends_at: null })], now).unknownWindow).toBe(1);
  });
  it("shows the earliest unpaid payout ETA even if it is overdue", () => {
    expect(earningsReport([post({ payout_eta: "2026-10-20T00:00:00Z" }), post({ payout_eta: "2026-10-25T00:00:00Z" })], now).nextEta).toBe("2026-10-20T00:00:00Z");
  });
  it("returns zero USD and no deadlines for an empty ledger", () => {
    const r = earningsReport([], now);
    expect([r.pending, r.paid, r.inWindow, r.observedViews]).toEqual([0, 0, 0, 0]);
    expect(r.nextEta).toBeNull();
  });
});