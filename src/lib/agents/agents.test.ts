import { describe, expect, it } from "vitest";
import { describeSchedule, nextRun, parseCron, prevRun } from "./cron";
import { agentHealth, summarizeRun } from "./agents";

const T = (s: string) => Date.parse(s);
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

describe("cron", () => {
  it("parses steps, ranges and lists", () => {
    const c = parseCron("2-59/5 */4 1,15 * 1-5");
    expect(c.minutes.slice(0, 3)).toEqual([2, 7, 12]);
    expect(c.minutes.length).toBe(12);
    expect(c.hours).toEqual([0, 4, 8, 12, 16, 20]);
    expect([...c.dom!]).toEqual([1, 15]);
    expect(c.months).toBeNull();
    expect([...c.dow!]).toEqual([1, 2, 3, 4, 5]);
    expect(parseCron("0 0 * * 7").dow!.has(0)).toBe(true);
    expect(() => parseCron("61 * * * *")).toThrow();
    expect(() => parseCron("* * *")).toThrow();
  });

  it("finds next and previous runs in UTC", () => {
    const c = parseCron("2-59/5 * * * *");
    expect(iso(nextRun(c, T("2026-10-22T07:52:00Z")))).toBe("2026-10-22T07:57:00.000Z");
    expect(iso(prevRun(c, T("2026-10-22T07:52:00Z")))).toBe("2026-10-22T07:52:00.000Z");
    expect(iso(nextRun(parseCron("5 */4 * * *"), T("2026-10-22T08:00:00Z")))).toBe(
      "2026-10-22T08:05:00.000Z",
    );
    expect(iso(nextRun(parseCron("20 0 * * *"), T("2026-10-22T08:00:00Z")))).toBe(
      "2026-10-23T00:20:00.000Z",
    );
    expect(iso(prevRun(parseCron("30 1 * * *"), T("2026-10-22T01:29:59Z")))).toBe(
      "2026-10-21T01:30:00.000Z",
    );
  });

  it("follows the owner's time zone across the end of summer time", () => {
    const c = parseCron("CRON_TZ=Europe/Stockholm 45 18 * * 0");
    // Sunday 25 Oct 2026: Sweden is back on UTC+1, so 18:45 local is 17:45 UTC.
    expect(iso(nextRun(c, T("2026-10-22T08:00:00Z")))).toBe("2026-10-25T17:45:00.000Z");
    // Sunday 18 Oct 2026 was still summer time (UTC+2).
    expect(iso(prevRun(c, T("2026-10-22T08:00:00Z")))).toBe("2026-10-18T16:45:00.000Z");
    expect(
      iso(nextRun(parseCron("CRON_TZ=Europe/Stockholm 45 8 * * *"), T("2026-10-22T06:46:00Z"))),
    ).toBe("2026-10-23T06:45:00.000Z");
  });

  it("describes schedules in words, in Swedish time", () => {
    const now = T("2026-10-22T08:00:00Z");
    expect(describeSchedule("2-59/5 * * * *", now)).toBe("Every 5 min");
    expect(describeSchedule("*/15 * * * *", now)).toBe("Every 15 min");
    expect(describeSchedule("50 * * * *", now)).toBe("Hourly at :50");
    expect(describeSchedule("5 */4 * * *", now)).toBe("Every 4 h at :05");
    expect(describeSchedule("41 3 * * *", now)).toBe("Daily at 05:41");
    expect(describeSchedule("CRON_TZ=Europe/Stockholm 45 8 * * *", now)).toBe("Daily at 08:45");
    expect(describeSchedule("CRON_TZ=Europe/Stockholm 29 18 * * 0", now)).toBe("Sundays at 18:29");
    expect(describeSchedule("not a cron", now)).toBe("not a cron");
  });
});

describe("agentHealth", () => {
  const now = T("2026-10-22T08:00:00Z");
  const app = { kind: "app", schedule: "2-59/5 * * * *", schedule_active: true, last_status: "ok" };

  it("is ok when the last scheduled run logged, and gives the next run", () => {
    const h = agentHealth({ ...app, last_run_at: "2026-10-22T07:57:00.300Z" }, now);
    expect(h.health).toBe("ok");
    expect(iso(h.next)).toBe("2026-10-22T08:02:00.000Z");
  });

  it("is overdue when runs stopped arriving", () => {
    expect(agentHealth({ ...app, last_run_at: "2026-10-22T07:37:00Z" }, now).health).toBe(
      "overdue",
    );
    // A daily job that ran yesterday is fine until today's run is due.
    const daily = { ...app, schedule: "41 3 * * *" };
    expect(agentHealth({ ...daily, last_run_at: "2026-10-22T03:41:00Z" }, now).health).toBe("ok");
    expect(agentHealth({ ...daily, last_run_at: "2026-10-21T03:41:00Z" }, now).health).toBe(
      "overdue",
    );
  });

  it("gives Claude tasks more time to log", () => {
    const claude = {
      kind: "claude",
      schedule: "25 * * * *",
      schedule_active: true,
      last_status: "ok",
    };
    expect(
      agentHealth({ ...claude, last_run_at: "2026-10-22T06:26:00Z" }, T("2026-10-22T07:59:00Z"))
        .health,
    ).toBe("ok");
    expect(
      agentHealth({ ...claude, last_run_at: "2026-10-22T06:26:00Z" }, T("2026-10-22T08:15:00Z"))
        .health,
    ).toBe("overdue");
  });

  it("reports errors, warnings, never-run and paused agents", () => {
    expect(
      agentHealth({ ...app, last_run_at: "2026-10-22T07:57:00Z", last_status: "error" }, now)
        .health,
    ).toBe("error");
    expect(
      agentHealth({ ...app, last_run_at: "2026-10-22T07:57:00Z", last_status: "warning" }, now)
        .health,
    ).toBe("warning");
    expect(agentHealth({ ...app, last_run_at: null }, now).health).toBe("never");
    expect(
      agentHealth({ ...app, schedule_active: false, last_run_at: "2026-10-22T07:57:00Z" }, now)
        .health,
    ).toBe("paused");
  });

  it("treats the Invo bridge as offline after 20 silent minutes", () => {
    const pc = { kind: "pc", schedule: null, schedule_active: true, last_status: "ok" };
    const on = agentHealth({ ...pc, last_run_at: "2026-10-22T07:55:00Z" }, now);
    expect(on.health).toBe("ok");
    expect(iso(on.next)).toBe("2026-10-22T07:58:00.000Z");
    expect(agentHealth({ ...pc, last_run_at: "2026-10-21T16:04:47Z" }, now)).toEqual({
      health: "offline",
      next: null,
    });
  });
});

describe("summarizeRun", () => {
  it("summarises the desk jobs", () => {
    expect(
      summarizeRun("signal_scanner", {
        sync: "212 coins",
        usd_sek: 10.9,
        signals: ["ETH short volume_breakout"],
      }),
    ).toEqual({
      status: "ok",
      items: 1,
      summary: "1 new signal: ETH short volume_breakout · market sync 212 coins",
    });
    expect(summarizeRun("signal_scanner", { sync: "error: timeout", signals: [] }).status).toBe(
      "warning",
    );
    expect(
      summarizeRun("executor", {
        expired: 1,
        shadow: ["SOL"],
        executed: ["ETH"],
        rejected: ["XRP: max open"],
        live: [],
      }),
    ).toEqual({
      status: "ok",
      items: 4,
      summary: "opened ETH · 1 shadow (SOL) · 1 blocked by risk (XRP) · 1 expired",
    });
    expect(
      summarizeRun("executor", { expired: 0, shadow: [], executed: [], rejected: [], live: [] })
        .summary,
    ).toBe("Nothing to execute");
    expect(summarizeRun("executor", { error: "no usd_sek" })).toEqual({
      status: "warning",
      items: 0,
      summary: "Skipped: no usd_sek",
    });
    expect(summarizeRun("live_watchdog", { skipped: "not configured" }).summary).toBe(
      "Idle: live trading is not set up",
    );
    expect(
      summarizeRun("live_watchdog", { network: "mainnet", actions: ["stop"], errors: ["timeout"] })
        .status,
    ).toBe("warning");
    expect(
      summarizeRun("universe_builder", {
        phase: "done",
        result: { pass: true, add: ["ENA", "ONDO"] },
      }).summary,
    ).toBe("Up to date: 2 extra coins on the paper desk");
  });

  it("summarises the scout jobs", () => {
    expect(
      summarizeRun("wallet_tracker", {
        wallets: 48,
        mirror: 20,
        events: 2,
        signals: ["ETH short"],
        exits: [],
        mimic: { opened: ["a"], closed: [] },
      }),
    ).toEqual({
      status: "ok",
      items: 2,
      summary:
        "48 traders watched · 2 position changes · follow 1 signal: ETH short · Mimic 1 opened, 0 closed",
    });
    expect(summarizeRun("wallet_tracker", { skipped: "previous run still busy" }).summary).toBe(
      "Skipped: previous run still busy",
    );
    expect(
      summarizeRun("wallet_grader", {
        processed: 0,
        failed: 3,
        queue: 10,
        graded: 900,
        watchlist: 40,
      }).status,
    ).toBe("warning");
    expect(
      summarizeRun("leaderboard_scout", { rows: 30123, passing_floor: 2100, selected: 800 })
        .summary,
    ).toBe("30,123 leaderboard rows · 2100 pass the floor · 800 selected");
    expect(
      summarizeRun("invo_fills", { ingested: [], remaining: 0, candidates: 140 }).summary,
    ).toBe("Invo fills up to date · 0 days left · 140 Invo candidates");
    expect(summarizeRun("copy_sync", { coins: 30, synced: [], stale: 0 }).summary).toBe(
      "All 30 coins fresh",
    );
    expect(
      summarizeRun("copy_backtest", {
        signals: 400,
        wallets: 60,
        variants: { tier_a: { all: { trades: 80 }, gate: { pass: false } } },
      }).summary,
    ).toBe("400 signals from 60 wallets · tier A 80 trades, gate fail");
  });
});
