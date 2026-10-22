import { createFileRoute, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, ChevronRight, Plus, ShieldCheck } from "lucide-react";
import {
  Button,
  Chip,
  EmptyState,
  Kpi,
  PageShell,
  Panel,
  ago,
  errText,
  inputCls,
  int,
  when,
} from "@/components/rewards/kit";
import {
  agentHealth,
  BRIDGE_OFFLINE_MIN,
  type AgentStatus,
  type Health,
} from "@/lib/agents/agents";
import { describeSchedule } from "@/lib/agents/cron";
import { agentRunsQueryOptions, agentStatusQueryOptions } from "@/lib/agents/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/agents")({
  loader: ({ context }) => context.queryClient.ensureQueryData(agentStatusQueryOptions),
  errorComponent: AgentsError,
  head: () => ({
    meta: [
      { title: "APEX — Trading agents" },
      {
        name: "description",
        content: "Every agent that runs APEX trading, when it last ran and what it did.",
      },
      { property: "og:title", content: "APEX — Trading agents" },
      {
        property: "og:description",
        content: "Every agent that runs APEX trading, when it last ran and what it did.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgentsPage,
});

const SECTIONS: { key: string; title: string }[] = [
  { key: "desk", title: "TRADING DESK" },
  { key: "scout", title: "SCOUT & COPY TRADING" },
  { key: "reports", title: "REPORTS" },
];

/** The path a trade takes: signal sources, review, the risk rules, execution, then the live safety checks. */
const PIPELINE: (string | { gate: string } | "+")[] = [
  "signal_scanner",
  "+",
  "wallet_tracker",
  "signal_reviewer",
  { gate: "Risk rules" },
  "executor",
  "live_watchdog",
];

const HEALTH: Record<Health, { label: string; dot: string; text: string }> = {
  ok: { label: "OK", dot: "bg-[var(--neon)] shadow-[0_0_6px_var(--neon)]", text: "text-neon" },
  warning: { label: "WARNING", dot: "bg-[var(--gold)]", text: "text-gold" },
  error: { label: "ERROR", dot: "bg-destructive", text: "text-destructive" },
  overdue: { label: "OVERDUE", dot: "bg-destructive", text: "text-destructive" },
  offline: { label: "OFFLINE", dot: "bg-destructive", text: "text-destructive" },
  never: {
    label: "NOT RUN YET",
    dot: "border border-muted-foreground/60",
    text: "text-muted-foreground",
  },
  paused: {
    label: "PAUSED",
    dot: "border border-muted-foreground/60",
    text: "text-muted-foreground",
  },
};
const BAD: Health[] = ["error", "overdue", "offline"];

const KIND_CHIP: Record<string, { label: string; tone: "cyan" | "gold" } | undefined> = {
  claude: { label: "Claude", tone: "cyan" },
  pc: { label: "Your PC", tone: "gold" },
};

function AgentsError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return (
    <div className="space-y-3 p-6">
      <p role="alert" className="text-destructive">
        {errText(error)}
      </p>
      <Button
        onClick={() => {
          void router.invalidate();
        }}
      >
        RETRY
      </Button>
    </div>
  );
}

type Row = AgentStatus & { health: Health; next: number | null; scheduleText: string };

function AgentsPage() {
  const status = useSuspenseQuery(agentStatusQueryOptions);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const runs = useQuery(agentRunsQueryOptions(filter, activeOnly));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const rows: Row[] = useMemo(
    () =>
      (status.data ?? []).map((a) => {
        const h = agentHealth(a, now);
        const scheduleText =
          a.kind === "pc"
            ? "Every 3 min (PC on)"
            : a.schedule
              ? describeSchedule(a.schedule, now)
              : "—";
        return { ...a, ...h, scheduleText };
      }),
    [status.data, now],
  );
  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);
  const nameOf = (key: string) => byKey.get(key)?.name ?? key;

  const stats = useMemo(() => {
    const bad = rows.filter((r) => BAD.includes(r.health));
    return {
      running: rows.filter((r) => r.health === "ok" || r.health === "warning").length,
      bad,
      runs: rows.reduce((s, r) => s + r.runs_24h, 0),
      items: rows.reduce((s, r) => s + r.items_24h, 0),
      problems: rows.reduce((s, r) => s + r.problems_24h, 0),
    };
  }, [rows]);

  return (
    <PageShell
      eyebrow="TRADING"
      title="AGENTS"
      subtitle="Everything that runs APEX trading: when each agent last ran, what it did and when it runs next. Refreshes every minute."
      actions={
        <span className="text-[10px] tracking-widest text-muted-foreground">
          UPDATED {when(new Date(status.dataUpdatedAt || now).toISOString()).slice(11)}
        </span>
      }
    >
      {rows.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="NO AGENTS FOUND"
          body="The trading agents appear here once their registry (desk_agents) is set up."
        />
      ) : (
        <>
          {stats.bad.length > 0 && (
            <section
              role="alert"
              className="space-y-2 rounded-lg border border-destructive/50 px-4 py-3"
            >
              {stats.bad.map((r) => (
                <p key={r.key} className="flex gap-2 text-xs leading-relaxed">
                  <AlertTriangle
                    className="mt-0.5 size-3.5 shrink-0 text-destructive"
                    aria-hidden="true"
                  />
                  <span>
                    <span className="text-destructive">{r.name}: </span>
                    <span className="text-foreground">{attention(r, now)}</span>
                  </span>
                </p>
              ))}
            </section>
          )}

          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi
              label="ON SCHEDULE"
              value={`${stats.running}/${rows.length}`}
              sub={
                stats.bad.length
                  ? `${stats.bad.map((r) => r.name).join(", ")} need${stats.bad.length === 1 ? "s" : ""} a look`
                  : "every agent is running"
              }
              tone={stats.bad.length ? "danger" : "neon"}
            />
            <Kpi
              label="RUNS · 24H"
              value={int(stats.runs)}
              sub="logged by the agents"
              tone="neon"
            />
            <Kpi
              label="ITEMS · 24H"
              value={int(stats.items)}
              sub="signals, trades, wallets and position changes handled"
              tone="cyan"
            />
            <Kpi
              label="WARNINGS · 24H"
              value={int(stats.problems)}
              sub={stats.problems ? "check the run log" : "all clean"}
              tone={stats.problems ? "danger" : "muted"}
            />
          </section>

          <Panel title="PIPELINE">
            <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2">
              {PIPELINE.map((step, i) => {
                const sep = i > 0 && step !== "+" && PIPELINE[i - 1] !== "+";
                return (
                  <Fragment key={i}>
                    {sep && (
                      <ChevronRight
                        aria-hidden="true"
                        className="size-3.5 shrink-0 text-muted-foreground/50"
                      />
                    )}
                    {step === "+" ? (
                      <Plus
                        aria-hidden="true"
                        className="size-3 shrink-0 text-muted-foreground/60"
                      />
                    ) : typeof step === "object" ? (
                      <li>
                        <Chip tone="gold" className="py-1">
                          <ShieldCheck className="size-3" /> {step.gate}
                        </Chip>
                      </li>
                    ) : (
                      <li
                        className="flex items-center gap-2 border border-border bg-terminal px-2.5 py-1.5 text-[11px]"
                        title={
                          byKey.get(step)
                            ? `${nameOf(step)}: ${HEALTH[byKey.get(step)!.health].label}`
                            : step
                        }
                      >
                        <span className="whitespace-nowrap text-foreground">{nameOf(step)}</span>
                        <HealthDot health={byKey.get(step)?.health ?? "never"} />
                      </li>
                    )}
                  </Fragment>
                );
              })}
            </ol>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              Signals come from the scanner&apos;s setups and from followed traders. The reviewer
              researches each one, the risk rules decide size and limits, and the executor opens the
              paper trade. Real money follows only when live trading is armed.
            </p>
          </Panel>

          {SECTIONS.map((s) => {
            const list = rows.filter((r) => r.section === s.key);
            if (!list.length) return null;
            return (
              <section key={s.key} className="space-y-3">
                <h2 className="text-xs tracking-[0.3em] text-neon">{s.title}</h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {list.map((a) => (
                    <AgentCard key={a.key} n={rows.indexOf(a) + 1} agent={a} now={now} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      )}

      <Panel
        title="RUN LOG"
        right={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
                className="accent-[var(--neon)]"
              />
              Only runs that did something
            </label>
            <select
              className={cn(inputCls, "w-auto")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Filter by agent"
            >
              <option value="all">All agents</option>
              {rows.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        }
      >
        {runs.error ? (
          <p role="alert" className="text-xs text-destructive">
            Could not load runs: {errText(runs.error)}
          </p>
        ) : runs.isLoading ? (
          <p className="text-xs tracking-[0.3em] text-neon">LOADING…</p>
        ) : !runs.data?.length ? (
          <p className="text-xs text-muted-foreground">
            {activeOnly
              ? "No runs with results yet. Untick “Only runs that did something” to see every run."
              : filter === "all"
                ? "No runs logged yet."
                : `${nameOf(filter)} has not logged a run yet.`}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <p className="mb-3 text-[10px] text-muted-foreground">
              Latest {runs.data.length} runs{activeOnly ? " that did something or warned" : ""}
            </p>
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
                {runs.data.map((r) => (
                  <tr key={r.id} className="border-t border-border/50 align-top">
                    <td
                      className="whitespace-nowrap py-1.5 pr-3 text-muted-foreground"
                      title={ago(r.started_at, now)}
                    >
                      {when(r.started_at)}
                    </td>
                    <td className="whitespace-nowrap py-1.5 pr-3">{nameOf(r.agent_key)}</td>
                    <td className="py-1.5 pr-3">
                      <RunStatus status={r.status} />
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{int(r.items)}</td>
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
    </PageShell>
  );
}

/** What needs doing about an agent that is offline, overdue or failing. */
function attention(r: Row, now: number) {
  if (r.health === "offline") {
    return `no round since ${when(r.last_run_at)} (${ago(r.last_run_at, now)}), so Invo follows are paused. It needs your PC on and awake; if it is, double-click start.cmd in Documents\\APEX Invo Bridge.`;
  }
  if (r.health === "overdue")
    return `last run ${ago(r.last_run_at, now)}, but it is scheduled ${r.scheduleText.toLowerCase()}, so at least one run is missing.`;
  return `last run failed: ${r.last_summary ?? "no details"}`;
}

function HealthDot({ health }: { health: Health }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", HEALTH[health].dot)}
    />
  );
}

function HealthBadge({ health }: { health: Health }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-[10px] tracking-widest",
        HEALTH[health].text,
      )}
    >
      <HealthDot health={health} /> {HEALTH[health].label}
    </span>
  );
}

function RunStatus({ status }: { status: string }) {
  const h: Health = status === "ok" ? "ok" : status === "warning" ? "warning" : "error";
  return <HealthBadge health={h} />;
}

function AgentCard({ n, agent: a, now }: { n: number; agent: Row; now: number }) {
  const kind = KIND_CHIP[a.kind];
  const nextText =
    a.next != null
      ? when(new Date(a.next).toISOString())
      : a.kind === "pc"
        ? "When your PC is on"
        : "—";
  return (
    <article
      className={cn("panel flex flex-col rounded-lg p-4", a.health === "paused" && "opacity-60")}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[10px] tracking-[0.3em] text-muted-foreground">
            <span className="tabular-nums">{String(n).padStart(2, "0")}</span>
            {a.role && <span>{a.role.toUpperCase()}</span>}
            {kind && <Chip tone={kind.tone}>{kind.label}</Chip>}
          </div>
          <h3 className="mt-1 font-display text-base font-bold tracking-[0.12em] text-foreground">
            {a.name}
          </h3>
        </div>
        <HealthBadge health={a.health} />
      </header>

      {a.description && (
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{a.description}</p>
      )}

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
        <dt className="text-muted-foreground">Last run</dt>
        <dd className="text-right text-foreground" title={when(a.last_run_at)}>
          {a.last_run_at ? ago(a.last_run_at, now) : "—"}
        </dd>
        <dt className="text-muted-foreground">Next run</dt>
        <dd className="text-right text-foreground">{nextText}</dd>
        <dt className="text-muted-foreground">Schedule</dt>
        <dd className="truncate text-right text-foreground" title={a.schedule ?? undefined}>
          {a.scheduleText}
        </dd>
        <dt className="text-muted-foreground">Runs · 24h</dt>
        <dd className="text-right text-foreground">
          {int(a.runs_24h)}
          {a.problems_24h > 0 && <span className="text-gold"> · {a.problems_24h} warned</span>}
        </dd>
      </dl>
      <p className="mt-3 border-t border-border pt-3 text-xs break-words text-muted-foreground">
        {a.kind === "pc" && a.health === "offline"
          ? `Silent for over ${BRIDGE_OFFLINE_MIN} min. Last round: ${a.last_summary ?? "—"}`
          : a.last_summary || "No run summary yet"}
      </p>
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
