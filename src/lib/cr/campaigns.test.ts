import { describe, expect, it } from "vitest";
import { campaignSearchSchema, filterCampaigns, type SortableCampaign } from "./campaigns";

const base: SortableCampaign = {
  id: "a", title: "Alpha", brand: "Brand", whop_url: "https://contentrewards.com/alpha",
  notes: null, status: "active", platforms: ["youtube"], score: 5,
  rate_per_1k_usd: 3, budget_remaining_usd: 140, budget_total_usd: 1000,
  deadline: "2026-10-25T00:00:00Z", created_at: "2026-10-21T00:00:00Z",
};
const rows = [base, { ...base, id: "b", title: "Beta", score: null, rate_per_1k_usd: 1,
  status: "paused", platforms: ["tiktok"], deadline: null }];
describe("campaign filtering and sorting", () => {
  it("combines search, status and platform filters", () => {
    const search = campaignSearchSchema.parse({ q: "alpha", status: "active", platform: "youtube" });
    expect(filterCampaigns(rows, search).map((c) => c.id)).toEqual(["a"]);
    expect(filterCampaigns(rows, { ...search, platform: "tiktok" })).toEqual([]);
  });
  it("sorts CPM in both directions", () => {
    const search = campaignSearchSchema.parse({ sort: "rate", direction: "asc" });
    expect(filterCampaigns(rows, search).map((c) => c.id)).toEqual(["b", "a"]);
    expect(filterCampaigns(rows, { ...search, direction: "desc" }).map((c) => c.id)).toEqual(["a", "b"]);
  });
  it("keeps unknown scores and deadlines last in both directions", () => {
    for (const sort of ["score", "deadline"] as const) {
      for (const direction of ["asc", "desc"] as const) {
        expect(filterCampaigns(rows, campaignSearchSchema.parse({ sort, direction })).map((c) => c.id)).toEqual(["a", "b"]);
      }
    }
  });
  it("shows only active campaigns under the existing 15% alert threshold", () => {
    expect(filterCampaigns(rows, campaignSearchSchema.parse({ budget: "low" })).map((c) => c.id)).toEqual(["a"]);
    expect(filterCampaigns([{ ...base, budget_remaining_usd: 150 }], campaignSearchSchema.parse({ budget: "low" }))).toEqual([]);
  });
});