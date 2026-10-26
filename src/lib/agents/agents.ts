// Trading agents: health of each agent for the /agents page and one-line summaries of cron job results for the run
// log. Pure, no I/O; the registry itself lives in public.desk_agents (migration 0022).
import { nextRun, parseCron, prevRun } from "./cron";

export type AgentKind = "app" | "claude" | "pc";
export type RunStatus = "ok" | "warning" | "error";

/** One row of desk_agent_status(). */
export type AgentStatus = {
  key: string;
  name: string;
  role: string | null;
  section: string;
  kind: string;
  description: string | null;
  sort: number;
  schedule: string | null;
  schedule_active: boolean;
  last_run_at: string | null;
  last_status: string | null;
  last_summary: string | null;
  runs_24h: number;
  problems_24h: number;
  items_24h: number;
};

export type Health = "ok" | "warning" | "error" | "overdue" | "offline" | "never" | "paused";

/** Seconds between Invo bridge rounds (BRIDGE.cycleSeconds) and when a silent bridge counts as offline. */
export const BRIDGE_CYCLE_S = 180;
export const BRIDGE_OFFLINE_MIN = 20;
/** How late a scheduled run may log before the agent counts as overdue: app jobs finish within minutes, Claude tasks
 * can start a few minutes late and research for a while. */
const GRACE_MS: Record<string, number> = { app: 10 * 60_000, claude: 45 * 60_000 };

export function agentHealth(
  a: Pick<AgentStatus, "kind" | "schedule" | "schedule_active" | "last_run_at" | "last_status">,
  now: number,
): { health: Health; next: number | null } {
  const last = a.last_run_at ? Date.parse(a.last_run_at) : null;
  if (a.kind === "pc") {
    if (last == null) return { health: "never", next: null };
    if (now - last > BRIDGE_OFFLINE_MIN * 60_000) return { health: "offline", next: null };
    return {
      health: a.last_status === "warning" ? "warning" : "ok",
      next: last + BRIDGE_CYCLE_S * 1000,
    };
  }
  if (!a.schedule_active) return { health: "paused", next: null };
  let cron;
  try {
    cron = a.schedule ? parseCron(a.schedule) : null;
  } catch {
    cron = null;
  }
  const next = cron ? nextRun(cron, now) : null;
  if (last == null) return { health: "never", next };
  if (a.last_status === "error") return { health: "error", next };
  if (cron) {
    const due = prevRun(cron, now - (GRACE_MS[a.kind] ?? GRACE_MS.app));
    if (due != null && last < due - 60_000) return { health: "overdue", next };
  }
  return { health: a.last_status === "warning" ? "warning" : "ok", next };
}

export type RunNote = { status: RunStatus; items: number; summary: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);
const plural = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;
/** At most `max` names, then "+N more". */
const names = (xs: string[], max = 4) =>
  xs.length > max ? `${xs.slice(0, max).join(", ")} +${xs.length - max} more` : xs.join(", ");

/** One line for the run log from a cron job's result (the JSON the route returns). */
export function summarizeRun(key: string, r: Any): RunNote {
  if (r == null || typeof r !== "object") return { status: "ok", items: 0, summary: "Done" };
  if (typeof r.error === "string")
    return { status: "warning", items: 0, summary: `Skipped: ${r.error}` };
  if (typeof r.skipped === "string" && key !== "live_watchdog")
    return { status: "ok", items: 0, summary: `Skipped: ${r.skipped}` };
  switch (key) {
    case "signal_scanner": {
      const sig = list(r.signals);
      const sync = String(r.sync ?? "");
      const parts = [
        sig.length ? `${plural(sig.length, "new signal")}: ${names(sig)}` : "No new signals",
      ];
      if (sync) parts.push(`market sync ${sync}`);
      return {
        status: sync.startsWith("error") ? "warning" : "ok",
        items: sig.length,
        summary: parts.join(" · "),
      };
    }
    case "executor": {
      const ex = list(r.executed),
        sh = list(r.shadow),
        rj = list(r.rejected),
        live = list(r.live),
        exp = n(r.expired);
      const parts: string[] = [];
      if (ex.length) parts.push(`opened ${names(ex)}`);
      if (sh.length) parts.push(`${sh.length} shadow (${names(sh)})`);
      if (rj.length)
        parts.push(`${rj.length} blocked by risk (${names(rj.map((x) => x.split(":")[0]))})`);
      if (exp) parts.push(`${exp} expired`);
      if (live.length) parts.push(`${live.length} live`);
      return {
        status: "ok",
        items: ex.length + sh.length + rj.length + exp,
        summary: parts.length ? parts.join(" · ") : "Nothing to execute",
      };
    }
    case "live_watchdog": {
      if (r.skipped === "not configured")
        return { status: "ok", items: 0, summary: "Idle: live trading is not set up" };
      if (r.skipped === "not armed and nothing open")
        return { status: "ok", items: 0, summary: "Idle: live is not armed and nothing is open" };
      if (typeof r.skipped === "string")
        return { status: "ok", items: 0, summary: `Skipped: ${r.skipped}` };
      const actions = list(r.actions),
        errors = list(r.errors);
      const parts = [
        actions.length
          ? `${plural(actions.length, "action")}: ${names(actions)}`
          : "Checked live positions, nothing to do",
      ];
      if (r.kill) parts.unshift("KILL: flattened live positions");
      if (errors.length) parts.push(`${plural(errors.length, "error")}: ${names(errors, 2)}`);
      return {
        status: errors.length || r.kill ? "warning" : "ok",
        items: actions.length,
        summary: parts.join(" · "),
      };
    }
    case "universe_builder": {
      if (r.phase === "backfill")
        return {
          status: "ok",
          items: n(r.ready),
          summary: `Backfilling coins ranked 21–40: ${n(r.ready)} of ${n(r.of)} ready`,
        };
      const res = r.result ?? {};
      const add = list(res.add);
      return {
        status: "ok",
        items: 0,
        summary: res.pass
          ? `Up to date: ${plural(add.length, "extra coin")} on the paper desk`
          : "Up to date: extra coins failed the test, paper desk stays on the top 20",
      };
    }
    case "leaderboard_scout": {
      return {
        status: "ok",
        items: n(r.selected),
        summary: `${n(r.rows).toLocaleString("en-US")} leaderboard rows · ${n(r.passing_floor)} pass the floor · ${n(r.selected)} selected`,
      };
    }
    case "invo_fills": {
      const days = list(r.ingested);
      return {
        status: "ok",
        items: days.length,
        summary: `${days.length ? `Read ${plural(days.length, "day")} of Invo fills` : "Invo fills up to date"} · ${n(r.remaining)} days left · ${n(r.candidates)} Invo candidates`,
      };
    }
    case "wallet_grader": {
      const done = n(r.processed),
        failed = n(r.failed);
      return {
        status: failed > 0 && done === 0 ? "warning" : "ok",
        items: done,
        summary: `Graded ${plural(done, "wallet")}${failed ? ` · ${failed} failed` : ""} · ${n(r.queue)} waiting · ${n(r.watchlist)} pass the full bar`,
      };
    }
    case "wallet_tracker": {
      const sig = list(r.signals),
        exits = list(r.exits);
      const mimic = r.mimic ?? {};
      const mo = list(mimic.opened),
        mc = list(mimic.closed);
      const parts = [
        `${n(r.wallets)} traders watched`,
        n(r.events) ? plural(n(r.events), "position change") : "no changes",
      ];
      if (sig.length) parts.push(`follow ${plural(sig.length, "signal")}: ${names(sig)}`);
      if (exits.length) parts.push(`closed ${names(exits)}`);
      if (mo.length || mc.length) parts.push(`Mimic ${mo.length} opened, ${mc.length} closed`);
      return { status: "ok", items: n(r.events), summary: parts.join(" · ") };
    }
    case "copy_sync": {
      const synced = list(r.synced);
      return {
        status: "ok",
        items: synced.length,
        summary: synced.length
          ? `Synced ${synced.length} of ${n(r.coins)} coins${n(r.stale) ? ` · ${n(r.stale)} still stale` : ""}`
          : `All ${n(r.coins)} coins fresh`,
      };
    }
    case "fx_engine": {
      const closed = list(r.closed);
      const parts = [`${n(r.quotes)} quotes`, `${plural(n(r.checked), "open position")} checked`];
      if (closed.length) parts.push(`closed ${names(closed)}`);
      if (n(r.candles)) parts.push(`${n(r.candles)} candles`);
      return { status: n(r.quotes) < 5 ? "warning" : "ok", items: n(r.checked), summary: parts.join(" · ") };
    }
    case "copy_backtest": {
      const v = r.variants ?? {};
      const part = (label: string, x: Any) =>
        x ? `${label} ${n(x.all?.trades)} trades, gate ${x.gate?.pass ? "PASS" : "fail"}` : null;
      const parts = [
        `${n(r.signals)} signals from ${n(r.wallets)} wallets`,
        part("tier A", v.tier_a),
        part("consensus", v.consensus),
      ].filter(Boolean);
      return { status: "ok", items: n(r.signals), summary: parts.join(" · ") };
    }
  }
  return { status: "ok", items: 0, summary: JSON.stringify(r).slice(0, 200) };
}

/** Error text for a failed run, kept short for the log. */
export const errorNote = (e: unknown): RunNote => ({
  status: "error",
  items: 0,
  summary: (e instanceof Error ? e.message : String(e)).slice(0, 300),
});
