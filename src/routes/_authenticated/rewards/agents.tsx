import { createFileRoute, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Fragment, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Bot, ChevronRight, ShieldCheck, Store } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Switch } from "@/components/ui/switch";
import {
  Chip,
  EmptyState,
  Kpi,
  Button,
  PageShell,
  Panel,
  StatusDot,
  ago,
  errText,
  inputCls,
  int,
  when,
} from "@/components/rewards/kit";
import { updateAgentFn } from "@/lib/cr/cr.functions";
import { AUTONOMY, PUBLIC_FACING_AGENTS, type Autonomy } from "@/lib/cr/logic";
import { agentsQueryOptions, agentRunsQueryOptions, useRefreshCr, type Agent } from "@/lib/cr/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/rewards/agents")({
  loader: ({ context }) => Promise.all([context.queryClient.ensureQueryData(agentsQueryOptions), context.queryClient.ensureQueryData(agentRunsQueryOptions(100))]),
  errorComponent: ManagementError,
  head: () => ({
    meta: [
      { title: "APEX — Agents" },
      { name: "description", content: "The Content Rewards agent team." },
      { property: "og:title", content: "APEX — Agents" },
      { property: "og:description", content: "The Content Rewards agent team." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgentsPage,
});

const AUTONOMY_HINT: Record<Autonomy, string> = {
  manual: "Does nothing until you run it",
  assisted: "Runs, then waits for you before handing on",
  auto: "Runs and hands on by itself",
};

/** Human checkpoints in the pipeline, shown after the agent with this key. */
const GATE_AFTER: Record<
  string,
  { label: string; icon: typeof ShieldCheck; tone: "gold" | "cyan" }
> = {
  qa_gatekeeper: { label: "You approve", icon: ShieldCheck, tone: "gold" },
  submitter: { label: "Brand approves", icon: Store, tone: "cyan" },
};

function ManagementError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return <div className="space-y-3 p-6"><p role="alert" className="text-destructive">{errText(error)}</p><Button onClick={() => { void router.invalidate(); }}>RETRY</Button></div>;
}

function AgentsPage() {
  const agents = useSuspenseQuery(agentsQueryOptions);
  const runs = useSuspenseQuery(agentRunsQueryOptions(100));
  const refresh = useRefreshCr();
  const update = useServerFn(updateAgentFn);
  const [filter, setFilter] = useState("all");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<Agent | null>(null);
  const now = Date.now();

  const list = useMemo(() => agents.data ?? [], [agents.data]);
  const nameOf = (key: string) => list.find((a) => a.key === key)?.name ?? key;

  const stats = useMemo(() => {
    const day = now - 864e5;
    const recent = (runs.data ?? []).filter((r) => Date.parse(r.started_at) >= day);
    return {
      mix: AUTONOMY.map((a) => ({ a, n: list.filter((x) => x.autonomy === a).length })),
      enabled: list.filter((a) => a.enabled).length,
      runs24h: recent.length,
      problems24h: recent.filter((r) => r.status !== "ok").length,
      items24h: recent.reduce((s, r) => s + r.items_processed, 0),
    };
  }, [list, runs.data, now]);

  const change = async (
    agent: Agent,
    patch: { enabled?: boolean; autonomy?: Autonomy },
    confirmed = false,
  ) => {
    if (patch.autonomy === "auto" && PUBLIC_FACING_AGENTS.includes(agent.key) && !confirmed) {
      setConfirm(agent);
      return;
    }
    if (busyKey) return;
    setBusyKey(agent.key);
    setError("");
    try {
      await update({ data: { key: agent.key, ...patch } });
      await refresh();
    } catch (e) {
      setError(`${agent.name}: ${errText(e)}`);
    } finally {
      setBusyKey(null);
    }
  };

  const shownRuns = (runs.data ?? []).filter((r) => filter === "all" || r.agent_key === filter);

  return (
    <PageShell
      title="AGENTS"

    >

      {error && (
        <div role="alert" className="rounded-lg border border-destructive/50 px-4 py-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {list.length > 0 && (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi
              label="AUTONOMY"
              value={
                <span className="flex items-baseline gap-3 text-lg">
                  {stats.mix.map(({ a, n }) => (
                    <span
                      key={a}
                      className={
                        a === "auto"
                          ? "text-neon"
                          : a === "assisted"
                            ? "text-foreground"
                            : "text-muted-foreground"
                      }
                    >
                      {n}
                      <span className="ml-1 text-[10px] tracking-widest text-muted-foreground">
                        {a.toUpperCase()}
                      </span>
                    </span>
                  ))}
                </span>
              }
              sub={`${stats.enabled} of ${list.length} enabled`}
            />
            <Kpi label="RUNS · 24H" value={stats.runs24h} sub="logged by the agents" tone="neon" />
            <Kpi
              label="ITEMS · 24H"
              value={int(stats.items24h)}
              sub="campaigns, clips or posts handled"
              tone="cyan"
            />
            <Kpi
              label="WARNINGS · 24H"
              value={stats.problems24h}
              sub={stats.problems24h > 0 ? "check the run log" : "all clean"}
              tone={stats.problems24h > 0 ? "danger" : "muted"}
            />
          </section>

          <Panel title="PIPELINE">
            <div>
              <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
                {list.map((a, i) => {
                  const gate = GATE_AFTER[a.key];
                  return (
                    <Fragment key={a.key}>
                      {i > 0 && (
                        <ChevronRight
                          aria-hidden="true"
                          className="size-3.5 shrink-0 text-muted-foreground/50"
                        />
                      )}
                      <li
                        className={cn(
                          "flex items-center gap-2 rounded border bg-terminal px-2.5 py-1.5 text-[11px]",
                          a.enabled ? "border-border" : "border-dashed border-border/60 opacity-50",
                        )}
                        title={`${a.name}: ${a.autonomy}${a.enabled ? "" : " (disabled)"}`}
                      >
                        <span className="tabular-nums text-muted-foreground">{i + 1}</span>
                        <span className="whitespace-nowrap text-foreground">{a.name}</span>
                        <AutonomyDot autonomy={a.autonomy} />
                      </li>
                      {gate && (
                        <>
                          <ChevronRight
                            aria-hidden="true"
                            className="size-3.5 shrink-0 text-muted-foreground/50"
                          />
                          <li>
                            <Chip tone={gate.tone} className="py-1">
                              <gate.icon className="size-3" /> {gate.label}
                            </Chip>
                          </li>
                        </>
                      )}
                    </Fragment>
                  );
                })}
              </ol>
            </div>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] tracking-widest text-muted-foreground">
              {AUTONOMY.map((a) => (
                <span key={a} className="inline-flex items-center gap-1.5">
                  <AutonomyDot autonomy={a} /> {a.toUpperCase()} · {AUTONOMY_HINT[a].toLowerCase()}
                </span>
              ))}
            </p>
          </Panel>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((a, i) => (
              <AgentCard
                key={a.key}
                n={i + 1}
                agent={a}
                busy={busyKey !== null}
                summary={runs.data.find((r) => r.agent_key === a.key)?.summary ?? null}
                now={now}
                onChange={(p) => change(a, p)}
              />
            ))}
          </div>
        </>
      )}

      {!agents.isLoading && list.length === 0 && !agents.error && (
        <EmptyState
          icon={Bot}
          title="NO AGENTS CONFIGURED"
          body="Your configured Content Rewards agents appear here once the team is set up."
        />
      )}

      <Panel
        title="RUN LOG"
        right={
          list.length > 0 && (
            <select
              className={cn(inputCls, "w-auto")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter by agent"
            >
              <option value="all">All agents</option>
              {list.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
            </select>
          )
        }
      >
        {shownRuns.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {filter === "all"
              ? "No runs logged yet. Connected agents add their results here after each run."
              : `${nameOf(filter)} has not logged a run yet.`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <p className="mb-3 text-[10px] text-muted-foreground">Latest {runs.data.length} runs</p>
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] tracking-widest text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-normal">STARTED</th>
                  <th className="py-1 pr-3 font-normal">AGENT</th>
                  <th className="py-1 pr-3 font-normal">STATUS</th>
                  <th className="py-1 pr-3 text-right font-normal">ITEMS</th>
                  <th className="py-1 pr-3 font-normal">TOOK</th>
                  <th className="py-1 font-normal">SUMMARY</th>
                </tr>
              </thead>
              <tbody>
                {shownRuns.map((r) => (
                  <tr key={r.id} className="border-t border-border/50 align-top">
                    <td
                      className="whitespace-nowrap py-1.5 pr-3 text-muted-foreground"
                      title={ago(r.started_at, now)}
                    >
                      {when(r.started_at)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-3">{nameOf(r.agent_key)}</td>
                    <td className="py-1.5 pr-3">
                      <StatusDot status={r.status} />
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {int(r.items_processed)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-muted-foreground">
                      {duration(r.started_at, r.finished_at)}
                    </td>
                    <td className="py-1.5 text-muted-foreground">{r.summary ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent className="panel font-mono">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-gold font-display tracking-[0.15em]">
              LET {confirm?.name.toUpperCase()} RUN ON ITS OWN?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-xs leading-relaxed">
              <span className="block">
                {confirm?.key === "publisher"
                  ? "Approved clips will be posted to your linked accounts without asking you first."
                  : "Live post links will be submitted to Content Rewards without asking you first."}
              </span>
              <span className="block">
                Only owner-approved clips may be posted. This saves the agent’s configuration; execution is handled by your connected agent team.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs tracking-widest">
              KEEP IT AS IS
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-[var(--gold)] font-mono text-xs tracking-widest text-background hover:bg-[var(--gold)]/90"
              onClick={() => {
                const a = confirm;
                setConfirm(null);
                if (a) void change(a, { autonomy: "auto" }, true);
              }}
            >
              SWITCH TO AUTO
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function AutonomyDot({ autonomy }: { autonomy: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        autonomy === "auto"
          ? "bg-[var(--neon)] shadow-[0_0_6px_var(--neon)]"
          : autonomy === "assisted"
            ? "bg-[var(--gold)]"
            : "border border-muted-foreground/60",
      )}
    />
  );
}

function AgentCard({
  n,
  summary,
  agent: a,
  busy,
  now,
  onChange,
}: {
  n: number;
  summary: string | null;
  agent: Agent;
  busy: boolean;
  now: number;
  onChange: (patch: { enabled?: boolean; autonomy?: Autonomy }) => void;
}) {
  const publicFacing = PUBLIC_FACING_AGENTS.includes(a.key);
  return (
    <article className={cn("panel flex flex-col rounded-lg p-4", !a.enabled && "opacity-60")}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[10px] tracking-[0.3em] text-muted-foreground">
            <span className="tabular-nums">{String(n).padStart(2, "0")}</span>
            {a.role && <span>{a.role.toUpperCase()}</span>}
            {publicFacing && <Chip tone="gold">public</Chip>}
          </div>
          <h3 className="mt-1 font-display text-base font-bold tracking-[0.12em] text-foreground">
            {a.name}
          </h3>
        </div>
        <Switch
          checked={a.enabled}
          disabled={busy}
          onCheckedChange={(v) => onChange({ enabled: v })}
          aria-label={`${a.name} enabled`}
          className="data-[state=checked]:bg-[var(--neon)]"
        />
      </header>

      {a.description && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{a.description}</p>
      )}

      <ToggleGroup type="single" value={a.autonomy} disabled={busy} onValueChange={(value) => { if (AUTONOMY.some((x) => x === value)) onChange({ autonomy: value as Autonomy }); }} aria-label={`${a.name} autonomy`} className="mt-3 grid grid-cols-3 border border-border rounded p-0.5">
        {AUTONOMY.map((level) => <ToggleGroupItem key={level} value={level} title={AUTONOMY_HINT[level]} className="min-w-0 px-1 text-[10px] data-[state=on]:text-neon">{level.toUpperCase()}</ToggleGroupItem>)}
      </ToggleGroup>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <dt className="text-muted-foreground">Last run</dt>
        <dd className="flex items-center justify-end gap-2 text-right">
          {a.last_run_at ? (
            <span className="text-foreground" title={when(a.last_run_at)}>
              {ago(a.last_run_at, now)}
            </span>
          ) : null}
          <StatusDot status={a.last_status} />
        </dd>
        <dt className="text-muted-foreground">Next run</dt>
        <dd className="text-right text-foreground">{a.next_run_at ? when(a.next_run_at) : "—"}</dd>
        <dt className="text-muted-foreground">Schedule</dt>
        <dd className="truncate text-right text-foreground" title={a.schedule_text ?? undefined}>
          {a.schedule_text || (a.autonomy === "manual" ? "On demand" : "After the previous stage")}
        </dd>
      </dl>
      <p className="mt-3 border-t border-border pt-3 text-xs break-words text-muted-foreground">{summary || "No run summary yet"}</p>
    </article>
  );
}

function duration(start: string, end: string | null) {
  if (!end) return "—";
  const s = Math.max(0, Math.round((Date.parse(end) - Date.parse(start)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
