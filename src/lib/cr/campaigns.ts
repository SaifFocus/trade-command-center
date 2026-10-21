import { z } from "zod";
import { CAMPAIGN_STATUSES, PLATFORMS, isBudgetLow } from "./logic";

export const campaignSearchSchema = z.object({
  q: z.string().catch(""),
  status: z.enum(["all", ...CAMPAIGN_STATUSES]).catch("all"),
  platform: z.enum(["all", ...PLATFORMS]).catch("all"),
  sort: z.enum(["score", "rate", "budget", "deadline", "newest"]).catch("score"),
  direction: z.enum(["asc", "desc"]).catch("desc"),
  budget: z.enum(["all", "low"]).catch("all"),
});
export type CampaignSearch = z.infer<typeof campaignSearchSchema>;
export type SortableCampaign = {
  id: string; title: string | null; brand: string | null; whop_url: string;
  notes: string | null; status: string; platforms: string[]; score: number | null;
  rate_per_1k_usd: number | null; budget_remaining_usd: number | null;
  budget_total_usd: number | null; deadline: string | null; created_at: string;
};

export function filterCampaigns<T extends SortableCampaign>(campaigns: T[], search: CampaignSearch): T[] {
  const term = search.q.trim().toLowerCase();
  const value = (c: T): number | null => {
    switch (search.sort) {
      case "score": return c.score;
      case "rate": return c.rate_per_1k_usd;
      case "budget": return c.budget_remaining_usd;
      case "deadline": return c.deadline ? Date.parse(c.deadline) : null;
      case "newest": return Date.parse(c.created_at);
    }
  };
  return campaigns.filter((c) =>
    (search.status === "all" || c.status === search.status) &&
    (search.platform === "all" || c.platforms.includes(search.platform)) &&
    (search.budget !== "low" || isBudgetLow(c)) &&
    (!term || [c.title, c.brand, c.whop_url, c.notes].some((v) => v?.toLowerCase().includes(term))),
  ).sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    const diff = av != null && bv != null ? av - bv : 0;
    return (search.direction === "asc" ? diff : -diff) || a.id.localeCompare(b.id);
  });
}