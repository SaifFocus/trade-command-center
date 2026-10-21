import { z } from "zod";
import { CAMPAIGN_STATUSES, PLATFORMS } from "./logic";

const money = z.number().min(0).max(100_000_000).nullable().optional();
const seconds = z.number().int().min(0).max(36_000).nullable().optional();
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const list = (max: number) => z.array(z.string().trim().min(1).max(500)).max(max).optional();
const webUrl = z.string().trim().url().max(500).refine((v) => /^https?:\/\//i.test(v), {
  message: "Use a full https:// campaign link.",
});

export const campaignInput = z.object({
  id: z.string().uuid().optional(),
  whop_url: webUrl,
  brand: text(120), title: text(200),
  category: z.enum(["clipping", "ugc", "other"]).optional(),
  rate_per_1k_usd: money, budget_total_usd: money, budget_remaining_usd: money,
  min_payout_usd: money, max_payout_usd: money, flat_fee_usd: money,
  platforms: z.array(z.enum(PLATFORMS)).max(5).optional(),
  min_length_s: seconds, max_length_s: seconds,
  required_hashtags: list(30), required_credit: text(200),
  disclosure_required: z.boolean().optional(), prohibited: text(2000),
  source_assets: z.array(webUrl).max(50).optional(), red_flags: list(30),
  deadline: z.string().datetime({ offset: true }).nullable().optional(),
  score: z.number().int().min(1).max(5).nullable().optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(), notes: text(4000),
}).refine((c) => c.budget_total_usd == null || c.budget_remaining_usd == null || c.budget_remaining_usd <= c.budget_total_usd, {
  message: "Budget remaining can't be more than the total budget.", path: ["budget_remaining_usd"],
}).refine((c) => c.min_length_s == null || c.max_length_s == null || c.min_length_s <= c.max_length_s, {
  message: "Maximum clip length must be at least the minimum.", path: ["max_length_s"],
});