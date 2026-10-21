import { describe, expect, it } from "vitest";
import { campaignInput } from "./campaign-input";

describe("campaign input", () => {
  const input = { whop_url: "https://contentrewards.com/campaign" };
  it("accepts a campaign with only a valid link", () => {
    expect(campaignInput.parse(input).whop_url).toBe(input.whop_url);
  });
  it("accepts all five campaign statuses and rejects unknown statuses", () => {
    for (const status of ["watching", "active", "paused", "closed", "rejected"]) {
      expect(campaignInput.safeParse({ ...input, status }).success).toBe(true);
    }
    expect(campaignInput.safeParse({ ...input, status: "published" }).success).toBe(false);
  });
  it("rejects remaining budget above total on the server", () => {
    expect(campaignInput.safeParse({ ...input, budget_total_usd: 1000, budget_remaining_usd: 1001 }).success).toBe(false);
    expect(campaignInput.safeParse({ ...input, budget_total_usd: 1000, budget_remaining_usd: 1000 }).success).toBe(true);
  });
  it("rejects executable URLs in campaign and source links", () => {
    expect(campaignInput.safeParse({ whop_url: "javascript:alert(1)" }).success).toBe(false);
    expect(campaignInput.safeParse({ ...input, source_assets: ["javascript:alert(1)"] }).success).toBe(false);
  });
  it("rejects inverted clip lengths", () => {
    expect(campaignInput.safeParse({ ...input, min_length_s: 45, max_length_s: 20 }).success).toBe(false);
  });
  it("preserves editable red flags", () => {
    expect(campaignInput.parse({ ...input, red_flags: ["Budget almost exhausted"] }).red_flags).toEqual(["Budget almost exhausted"]);
  });
});