import { describe, expect, it } from "vitest";
import {
  approvalRate,
  budgetShare,
  estimateEarnings,
  formatLeft,
  isBudgetLow,
  msLeft,
  netPer1k,
  profileUrl,
  specChecklist,
  viewsAtCap,
  viewsForTarget,
  viewsToMinimum,
} from "./logic";

const terms = { rate_per_1k_usd: 3, min_payout_usd: 6, max_payout_usd: 3000, flat_fee_usd: null };

describe("estimateEarnings", () => {
  it("pays nothing below the minimum payout", () => {
    expect(estimateEarnings(1999, terms)).toEqual({
      gross: 0,
      net: 0,
      belowMin: true,
      capped: false,
    });
  });

  it("pays from the minimum upwards, minus the 10% fee", () => {
    const e = estimateEarnings(2000, terms);
    expect(e.gross).toBe(6);
    expect(e.net).toBe(5.4);
    expect(e.belowMin).toBe(false);
  });

  it("caps view earnings at the max payout", () => {
    const e = estimateEarnings(2_000_000, terms);
    expect(e.gross).toBe(3000);
    expect(e.capped).toBe(true);
  });

  it("adds the flat fee on top of capped view earnings", () => {
    // Whop docs example: $3 rate, $10 flat fee, 2,000 views = $16 before fee.
    const e = estimateEarnings(2000, { ...terms, min_payout_usd: null, flat_fee_usd: 10 });
    expect(e.gross).toBe(16);
    expect(e.net).toBe(14.4);
  });

  it("treats a missing rate and bad views as zero", () => {
    expect(
      estimateEarnings(Number.NaN, { ...terms, rate_per_1k_usd: null, min_payout_usd: null }).gross,
    ).toBe(0);
  });
});

describe("views thresholds", () => {
  it("matches the Whop docs examples", () => {
    expect(viewsToMinimum(terms)).toBe(2000);
    expect(viewsAtCap(terms)).toBe(1_000_000);
  });

  it("returns null without a rate", () => {
    expect(viewsToMinimum({ ...terms, rate_per_1k_usd: null })).toBeNull();
    expect(viewsAtCap({ ...terms, max_payout_usd: null })).toBeNull();
  });
});

describe("budget", () => {
  it("computes the share left and flags active campaigns under 15%", () => {
    const c = { status: "active", budget_total_usd: 1000, budget_remaining_usd: 140 };
    expect(budgetShare(c)).toBeCloseTo(0.14);
    expect(isBudgetLow(c)).toBe(true);
    expect(isBudgetLow({ ...c, budget_remaining_usd: 150 })).toBe(false);
  });

  it("ignores non-active campaigns and unknown budgets", () => {
    expect(
      isBudgetLow({ status: "paused", budget_total_usd: 1000, budget_remaining_usd: 10 }),
    ).toBe(false);
    expect(
      isBudgetLow({ status: "active", budget_total_usd: null, budget_remaining_usd: 10 }),
    ).toBe(false);
    expect(
      budgetShare({ status: "active", budget_total_usd: 1000, budget_remaining_usd: null }),
    ).toBeNull();
  });
});

describe("time left", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  it("formats days, hours and the end", () => {
    expect(formatLeft(msLeft("2026-10-12T16:30:00Z", now))).toBe("2d 4h");
    expect(formatLeft(msLeft("2026-10-10T17:12:00Z", now))).toBe("5h 12m");
    expect(formatLeft(msLeft("2026-10-09T00:00:00Z", now))).toBe("ended");
    expect(formatLeft(msLeft(null, now))).toBe("—");
  });
});

describe("specChecklist", () => {
  const spec = {
    min_length_s: 15,
    max_length_s: 60,
    required_hashtags: ["#brand"],
    required_credit: "@brand",
    disclosure_required: true,
    source_assets: ["https://www.youtube.com/watch?v=abc"],
    prohibited: null,
  };
  const clip = {
    source_url: "https://youtube.com/watch?v=abc&t=120",
    source_start_s: 120,
    source_end_s: 150,
    hook: "He said what?",
  };

  it("passes length and source, and lists caption items to confirm", () => {
    const items = specChecklist(spec, clip);
    const by = Object.fromEntries(items.map((i) => [i.label, i.status]));
    expect(by).toEqual({
      Length: "ok",
      Source: "ok",
      Hook: "check",
      Hashtags: "check",
      Credit: "check",
      Disclosure: "check",
    });
  });

  it("fails clips that are too long, off-list or missing a hook", () => {
    const items = specChecklist(spec, {
      source_url: "https://youtube.com/watch?v=zzz",
      source_start_s: 0,
      source_end_s: 90,
      hook: " ",
    });
    const by = Object.fromEntries(items.map((i) => [i.label, i.status]));
    expect(by.Length).toBe("fail");
    expect(by.Source).toBe("fail");
    expect(by.Hook).toBe("fail");
  });

  it("does not treat a different video id as the same source", () => {
    const items = specChecklist(spec, { ...clip, source_url: "https://youtube.com/watch?v=abcd" });
    expect(items.find((i) => i.label === "Source")?.status).toBe("fail");
  });
});

describe("earnings stats", () => {
  it("counts only decided submissions in the approval rate", () => {
    const s = (submission_status: string) => ({ submission_status });
    expect(approvalRate([])).toBeNull();
    expect(approvalRate([s("pending"), s("submitted")])).toBeNull();
    expect(approvalRate([s("approved"), s("approved"), s("denied"), s("pending")])).toBeCloseTo(
      2 / 3,
    );
  });

  it("computes net per 1,000 views", () => {
    expect(netPer1k(9, 10_000)).toBe(0.9);
    expect(netPer1k(5, 0)).toBeNull();
  });

  it("matches the research table: $1,000 a month at a $1 CPM needs ~1.11M paid views", () => {
    expect(viewsForTarget(1000, 1)).toBe(1_111_112);
    expect(viewsForTarget(500, 3)).toBe(185_186);
    expect(viewsForTarget(1000, 0)).toBeNull();
    expect(viewsForTarget(0, 1)).toBeNull();
  });
});

describe("profileUrl", () => {
  it("builds profile links and strips a leading @", () => {
    expect(profileUrl("tiktok", "@saif")).toBe("https://www.tiktok.com/@saif");
    expect(profileUrl("instagram", "saif")).toBe("https://www.instagram.com/saif");
    expect(profileUrl("youtube", "saif")).toBe("https://www.youtube.com/@saif");
    expect(profileUrl("x", "saif")).toBe("https://x.com/saif");
    expect(profileUrl("other", "saif")).toBeNull();
  });
});
