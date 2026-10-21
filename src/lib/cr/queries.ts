import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { estimateEarnings, isBudgetLow } from "./logic";
import { estimatedNet } from "./reporting";

// Browser reads for the /rewards pages. RLS limits every cr_* table to the owner (SELECT only).

export type Campaign = Tables<"cr_campaigns">;
export type Account = Tables<"cr_accounts">;
export type Agent = Tables<"cr_agents">;
export type AgentRun = Tables<"cr_agent_runs">;
export type Clip = Tables<"cr_clips"> & {
  cr_campaigns: Pick<Campaign, "id" | "title" | "brand"> | null;
  cr_posts: { id: string; account_id: string | null; platform: string | null }[];
};
export type Post = Tables<"cr_posts"> & {
  cr_clips:
    | (Pick<Tables<"cr_clips">, "id" | "hook" | "variant" | "campaign_id"> & {
        cr_campaigns: Pick<
          Campaign,
          | "id"
          | "title"
          | "brand"
          | "rate_per_1k_usd"
          | "min_payout_usd"
          | "max_payout_usd"
          | "flat_fee_usd"
        > | null;
      })
    | null;
  cr_accounts: Pick<Account, "id" | "platform" | "handle"> | null;
};

const REFRESH = 60_000;

async function must<T>(
  p: PromiseLike<{ data: T | null; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

export const campaignsQueryOptions = queryOptions({
    queryKey: ["cr", "campaigns"],
    refetchInterval: REFRESH,
    queryFn: () =>
      must<Campaign[]>(
        supabase.from("cr_campaigns").select("*").order("created_at", { ascending: false }),
      ),
  });

export function useCampaigns() {
  return useQuery(campaignsQueryOptions);
}

export const clipsQueryOptions = queryOptions({
    queryKey: ["cr", "clips"],
    refetchInterval: REFRESH,
    queryFn: async () => {
      const clips: Clip[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = await must<Clip[]>(supabase
          .from("cr_clips")
          .select("*, cr_campaigns(id, title, brand), cr_posts(id, account_id, platform)")
          .order("updated_at", { ascending: false })
          .order("id")
          .range(offset, offset + 499));
        clips.push(...page);
        if (page.length < 500) return clips;
      }
    },
  });

export function useClips() {
  return useQuery(clipsQueryOptions);
}

export const postsQueryOptions = queryOptions({
    queryKey: ["cr", "posts"],
    refetchInterval: REFRESH,
    queryFn: async () => {
      const posts: Post[] = [];
      for (let offset = 0; ; offset += 500) {
        const page = await must<Post[]>(supabase.from("cr_posts")
          .select("*, cr_clips(id, hook, variant, campaign_id, cr_campaigns(id, title, brand, rate_per_1k_usd, min_payout_usd, max_payout_usd, flat_fee_usd)), cr_accounts(id, platform, handle)")
          .order("posted_at", { ascending: false, nullsFirst: false }).order("id")
          .range(offset, offset + 499));
        posts.push(...page);
        if (page.length < 500) return posts;
      }
    },
  });
export function usePosts() {
  return useQuery(postsQueryOptions);
}

export const accountsQueryOptions = queryOptions({
    queryKey: ["cr", "accounts"],
    refetchInterval: REFRESH,
    queryFn: () =>
      must<Account[]>(supabase.from("cr_accounts").select("*").order("platform").order("handle")),
  });
export function useAccounts() {
  return useQuery(accountsQueryOptions);
}

export const agentsQueryOptions = queryOptions({
    queryKey: ["cr", "agents"],
    refetchInterval: REFRESH,
    queryFn: () => must<Agent[]>(supabase.from("cr_agents").select("*").order("sort")),
  });
export function useAgents() {
  return useQuery(agentsQueryOptions);
}

export const agentRunsQueryOptions = (limit = 50) => queryOptions({
    queryKey: ["cr", "runs", limit],
    refetchInterval: REFRESH,
    queryFn: () =>
      must<AgentRun[]>(
        supabase
          .from("cr_agent_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(limit),
      ),
  });
export function useAgentRuns(limit = 50) {
  return useQuery(agentRunsQueryOptions(limit));
}

/** Sidebar badges: clips waiting for approval and active campaigns under 15% budget. */
export function useNavCounts() {
  return useQuery({
    queryKey: ["cr", "nav-counts"],
    refetchInterval: REFRESH,
    queryFn: async () => {
      const [approvals, active] = await Promise.all([
        supabase
          .from("cr_clips")
          .select("id", { count: "exact", head: true })
          .eq("stage", "awaiting_approval"),
        supabase
          .from("cr_campaigns")
          .select("status, budget_total_usd, budget_remaining_usd")
          .eq("status", "active"),
      ]);
      return {
        approvals: approvals.count ?? 0,
        lowBudget: (active.data ?? []).filter((c) => isBudgetLow(c)).length,
      };
    },
  });
}

/** Paper or live, for the sidebar status line. */
export function useDeskMode() {
  return useQuery({
    queryKey: ["desk-mode"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("desk_config")
        .select("mode, live_armed")
        .limit(1)
        .maybeSingle();
      return { liveArmed: data?.live_armed === true, mode: data?.mode ?? "paper" };
    },
  });
}

/** Refetch every Content Rewards query after an owner action. */
export function useRefreshCr() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["cr"] });
}

/** Net estimate for a post: the Analyst's stored figure when present, else computed from views. */
export function postNet(p: Post): number {
  return estimatedNet(p);
}
