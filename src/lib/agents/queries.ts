// Client reads for the trading Agents page (owner-only RLS and the owner-gated desk_agent_status()).
import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AgentStatus } from "./agents";

export type AgentRun = {
  id: string;
  agent_key: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  items: number;
  summary: string | null;
};

const REFRESH_MS = 60_000;

export const agentStatusQueryOptions = queryOptions({
  queryKey: ["agents", "status"],
  refetchInterval: REFRESH_MS,
  queryFn: async (): Promise<AgentStatus[]> => {
    const { data, error } = await supabase.rpc("desk_agent_status");
    if (error) throw new Error(error.message);
    return (data ?? []) as AgentStatus[];
  },
});

/** Latest runs, newest first. `agent` is a key or "all"; `activeOnly` hides runs that found nothing to do. */
export const agentRunsQueryOptions = (agent: string, activeOnly: boolean) =>
  queryOptions({
    queryKey: ["agents", "runs", agent, activeOnly],
    refetchInterval: REFRESH_MS,
    queryFn: async (): Promise<AgentRun[]> => {
      const out: AgentRun[] = [];
      if (agent !== "invo_bridge") {
        let q = supabase
          .from("desk_agent_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(100);
        if (agent !== "all") q = q.eq("agent_key", agent);
        if (activeOnly) q = q.or("status.neq.ok,items.gt.0");
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        out.push(...(data ?? []).map((r) => ({ ...r, id: String(r.id) })));
      }
      if (agent === "all" || agent === "invo_bridge") {
        // The Invo bridge logs every round in its own table.
        const { data, error } = await supabase
          .from("invo_bridge_runs")
          .select("*")
          .order("at", { ascending: false })
          .limit(200);
        if (error) throw new Error(error.message);
        for (const b of data ?? []) {
          const problems = Array.isArray(b.problems) ? b.problems.length : 0;
          const bad = b.logged_out || problems > 0;
          if (activeOnly && !bad && b.events === 0) continue;
          out.push({
            id: `bridge-${b.id}`,
            agent_key: "invo_bridge",
            started_at: b.at,
            finished_at: b.at,
            status: bad ? "warning" : "ok",
            items: b.events,
            summary: b.logged_out
              ? "Logged out of Invo"
              : `Read ${b.parsed} of ${b.visited} portfolios · ${b.positions} open positions${b.events ? ` · ${b.events} change(s)` : ""}${problems ? ` · ${problems} unreadable` : ""}`,
          });
        }
      }
      return out.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at)).slice(0, 100);
    },
  });
