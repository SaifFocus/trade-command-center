import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AlertTriangle, Rocket } from "lucide-react";
import {
  Chip,
  Kpi,
  LoadState,
  PageShell,
  Panel,
  StatusDot,
  ago,
  compact,
  int,
  usd,
  when,
} from "@/components/rewards/kit";
import { CLIP_STAGES, IN_PIPELINE, STAGE_LABEL, budgetShare, isBudgetLow } from "@/lib/cr/logic";
import {
  postNet,
  useAgentRuns,
  useAgents,
  useAccounts,
  useCampaigns,
  useClips,
  usePosts,
} from "@/lib/cr/queries";

export const Route = createFileRoute("/_authenticated/rewards/")({
  head: () => ({
    meta: [
      { title: "APEX — Content Rewards" },
      { name: "description", content: "Content Rewards control room." },
    ],
  }),
  component: Overview,
});

function Overview() {
  const campaigns = useCampaigns();
  const clips = useClips();
  const posts = usePosts();
  const agents = useAgents();
  const runs = useAgentRuns(8);
  const accounts = useAccounts();
  const now = Date.now();

  const k = useMemo(() => {
    const cs = campaigns.data ?? [];
    const cl = clips.data ?? [];
    const ps = posts.data ?? [];
    const weekAgo = now - 7 * 864e5;
    const live = ps.filter((p) => p.submission_status !== "denied");
    const etas = live
      .filter((p) => p.payout_eta && Date.parse(p.payout_eta) > now && p.paid_usd < postNet(p))
      .map((p) => p.payout_eta as string)
      .sort();
    return {
      active: cs.filter((c) => c.status === "active").length,
      watching: cs.filter((c) => c.status === "watching").length,
      inPipeline: cl.filter((c) => IN_PIPELINE.includes(c.stage as never)).length,
      awaiting: cl.filter((c) => c.stage === "awaiting_approval").length,
      inWindow: ps.filter(
        (p) => p.earning_window_ends_at && Date.parse(p.earning_window_ends_at) > now,
      ).length,
      views7d: ps
        .filter((p) => p.posted_at && Date.parse(p.posted_at) >= weekAgo)
        .reduce((s, p) => s + p.views_current, 0),
      pending: live.reduce((s, p) => s + Math.max(0, postNet(p) - p.paid_usd), 0),
      paid: ps.reduce((s, p) => s + p.paid_usd, 0),
      nextEta: etas[0] ?? null,
      low: cs.filter((c) => isBudgetLow(c)),
      stageCounts: CLIP_STAGES.map((s) => ({
        stage: s,
        n: cl.filter((c) => c.stage === s).length,
      })),
    };
  }, [campaigns.data, clips.data, posts.data, now]);

  const agentName = (key: string) => agents.data?.find((a) => a.key === key)?.name ?? key;
  const loading = campaigns.isLoading || clips.isLoading || posts.isLoading;
  const error = campaigns.error || clips.error || posts.error;
  const fresh =
    !loading && !error && (campaigns.data?.length ?? 0) === 0 && (accounts.data?.length ?? 0) === 0;
  const maxStage = Math.max(
    1,
    ...k.stageCounts.filter((s) => s.stage !== "denied").map((s) => s.n),
  );

  return (
    <PageShell
      title="OVERVIEW"
      subtitle="Campaigns, clips and payouts from the Content Rewards agents."
    >
      <LoadState loading={loading} error={error} />

      {fresh && (
        <Panel title="GET STARTED">
          <div className="flex items-start gap-3">
            <Rocket className="mt-0.5 size-5 shrink-0 text-gold" />
            <ol className="list-decimal space-y-1 pl-4 text-xs text-muted-foreground">
              <li>
                Link your posting accounts in Content Rewards, then add them under{" "}
                <Link to="/rewards/accounts" className="text-neon hover:underline">
                  Accounts
                </Link>
                .
              </li>
              <li>
                Add a campaign you want to clip under{" "}
                <Link to="/rewards/campaigns" className="text-neon hover:underline">
                  Campaigns
                </Link>
                , or let the Campaign Scout agent find them.
              </li>
              <li>
                Run a clipping cycle with the agents; clips that pass QA land in Approvals for your
                sign-off.
              </li>
            </ol>
          </div>
        </Panel>
      )}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Kpi
          label="ACTIVE CAMPAIGNS"
          value={k.active}
          sub={`${k.watching} watching`}
          tone="neon"
          to="/rewards/campaigns"
        />
        <Kpi
          label="CLIPS IN PIPELINE"
          value={k.inPipeline}
          sub="found → approved"
          to="/rewards/pipeline"
        />
        <Kpi
          label="AWAITING APPROVAL"
          value={k.awaiting}
          sub={k.awaiting > 0 ? "needs you" : "queue clear"}
          tone={k.awaiting > 0 ? "gold" : "muted"}
          to="/rewards/approvals"
        />
        <Kpi label="IN EARNING WINDOW" value={k.inWindow} sub="posts still counting views" />
        <Kpi
          label="VIEWS · LAST 7D"
          value={compact(k.views7d)}
          sub="posts from the last 7 days"
          tone="cyan"
        />
        <Kpi
          label="PENDING EARNINGS"
          value={usd(k.pending)}
          sub="estimate, after 10% fee"
          tone="gold"
          to="/rewards/earnings"
        />
        <Kpi
          label="PAID TO DATE"
          value={usd(k.paid)}
          sub={k.nextEta ? `next payout ~${when(k.nextEta)}` : "no payout scheduled"}
          tone="neon"
          to="/rewards/earnings"
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel
          title="PIPELINE BY STAGE"
          className="lg:col-span-2"
          right={
            <Link
              to="/rewards/pipeline"
              className="text-[11px] tracking-widest text-muted-foreground hover:text-neon"
            >
              OPEN BOARD →
            </Link>
          }
        >
          <div className="space-y-1.5">
            {k.stageCounts.map(({ stage, n }) => (
              <div
                key={stage}
                className="grid grid-cols-[130px_1fr_40px] items-center gap-3 text-xs"
              >
                <span
                  className={
                    stage === "awaiting_approval"
                      ? "text-gold"
                      : stage === "denied"
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }
                >
                  {STAGE_LABEL[stage]}
                </span>
                <div className="h-2 rounded-full bg-terminal">
                  <div
                    className={
                      stage === "denied"
                        ? "h-2 rounded-full bg-destructive/70"
                        : stage === "awaiting_approval"
                          ? "h-2 rounded-full bg-[var(--gold)]"
                          : "h-2 rounded-full bg-[color-mix(in_oklab,var(--neon)_70%,transparent)]"
                    }
                    style={{ width: `${Math.min(100, (n / maxStage) * 100)}%` }}
                  />
                </div>
                <span className="text-right tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="BUDGET DRAINING">
          {k.low.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No active campaign is under 15% of its budget.
            </p>
          ) : (
            <ul className="space-y-2">
              {k.low.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-xs">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <div className="min-w-0">
                    <div className="truncate text-foreground">
                      {c.title || c.brand || c.whop_url}
                    </div>
                    <div className="text-muted-foreground">
                      {usd(c.budget_remaining_usd, 0)} left ·{" "}
                      {Math.round((budgetShare(c) ?? 0) * 100)}% of {usd(c.budget_total_usd, 0)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title="LATEST AGENT RUNS"
        right={
          <Link
            to="/rewards/agents"
            className="text-[11px] tracking-widest text-muted-foreground hover:text-neon"
          >
            ALL AGENTS →
          </Link>
        }
      >
        {(runs.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No agent has reported a run yet. Runs appear here as soon as an agent logs one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] tracking-widest text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-normal">WHEN</th>
                  <th className="py-1 pr-3 font-normal">AGENT</th>
                  <th className="py-1 pr-3 font-normal">STATUS</th>
                  <th className="py-1 pr-3 font-normal">ITEMS</th>
                  <th className="py-1 font-normal">SUMMARY</th>
                </tr>
              </thead>
              <tbody>
                {(runs.data ?? []).map((r) => (
                  <tr key={r.id} className="border-t border-border/50 align-top">
                    <td
                      className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground"
                      title={when(r.started_at)}
                    >
                      {ago(r.started_at, now)}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{agentName(r.agent_key)}</td>
                    <td className="py-1.5 pr-3">
                      <StatusDot status={r.status} />
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">{int(r.items_processed)}</td>
                    <td className="py-1.5 text-muted-foreground">{r.summary ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-center text-[10px] tracking-[0.3em] text-muted-foreground">
        ESTIMATES USE EACH CAMPAIGN'S RATE, MINIMUM, CAP AND THE 10% FEE · VERIFIED NUMBERS WIN ·{" "}
        <Chip tone="muted">USD</Chip>
      </p>
    </PageShell>
  );
}
