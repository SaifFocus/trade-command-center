// Paper universe check (cron /api/cron/desk-universe): backfill full history for coins ranked 21–40 by volume, backtest
// them as a group with the same engine and costs, and add the ones that pass to desk_config.paper_extra_coins.
// Paper only: the live desk keeps its own whitelist.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ALWAYS_COINS, backfillCoin } from "./sync.server";
import { loadCoinData, CONFIGS } from "./backtest.server";
import { runBacktest, summarize, stats } from "./engine";
import { candidateCoins, deskCoins, universeDecision, type UniRow } from "./universe";

type DB = SupabaseClient<Database>;
const JOB = "paper_universe";
const D1 = 86400_000;

type JobState = {
  phase?: "backfill" | "done";
  candidates?: string[];
  ready?: string[];
  failed?: Record<string, number>;
  result?: unknown;
};

async function log(db: DB, message: string, level: "INFO" | "WARNING" | "ERROR" = "INFO") {
  await db.from("agent_logs").insert({ agent_name: "PAPER DESK", message, level, market_id: "swing" });
}

async function getState(db: DB): Promise<JobState> {
  const { data } = await db.from("sm_jobs").select("state").eq("name", JOB).maybeSingle();
  return ((data?.state as JobState | null) ?? {}) as JobState;
}

async function setState(db: DB, patch: JobState & Record<string, unknown>) {
  const cur = await getState(db);
  await db.from("sm_jobs").upsert({ name: JOB, state: { ...cur, ...patch } as never, updated_at: new Date().toISOString() });
}

export async function latestUniverseRows(db: DB): Promise<UniRow[]> {
  const { data: last } = await db.from("hl_universe").select("snapshot_at").order("snapshot_at", { ascending: false }).limit(1);
  if (!last?.[0]) return [];
  const { data } = await db.from("hl_universe").select("coin,day_ntl_vlm").eq("snapshot_at", last[0].snapshot_at);
  return (data ?? []).map((r) => ({ coin: r.coin, day_ntl_vlm: Number(r.day_ntl_vlm ?? 0) }));
}

/** Coins the paper desk signals on right now (base top 20 + always-on + validated extras). */
export async function deskUniverse(db: DB): Promise<string[]> {
  const [rows, { data: cfg }] = await Promise.all([latestUniverseRows(db), db.from("desk_config").select("paper_extra_coins").eq("id", 1).single()]);
  return deskCoins(rows, ALWAYS_COINS, cfg?.paper_extra_coins ?? []);
}

async function validate(db: DB, candidates: string[]) {
  const rows = await latestUniverseRows(db);
  const vol = new Map(rows.map((r) => [r.coin, r.day_ntl_vlm]));
  const data = await loadCoinData(db, [...candidates, "BTC"]);
  const params = CONFIGS[0];
  const res = runBacktest(data, params, "BTC", new Set(candidates));
  const s = summarize(res.trades);
  const coins = candidates.map((coin) => {
    const d = data.find((x) => x.coin === coin);
    const st = stats(res.trades.filter((t) => t.coin === coin));
    const span = d && d.c4h.length ? (d.c4h[d.c4h.length - 1].t - d.c4h[0].t) / D1 : 0;
    return { coin, trades: st.trades, expectancy_r: st.expectancy_r, history_days: span, day_ntl_vlm: vol.get(coin) ?? 0 };
  });
  const decision = universeDecision(
    { trades: s.all.trades, expectancy_in: s.in.expectancy_r, expectancy_out: s.out.expectancy_r, profit_factor: s.all.profit_factor ?? 0, max_drawdown_pct: s.all.max_drawdown_pct },
    coins,
  );
  const summary = {
    kind: "universe_check", config: params.name, coins: candidates,
    range: { start: new Date(res.startT).toISOString(), split: new Date(res.splitT).toISOString(), end: new Date(res.endT).toISOString() },
    ...s, per_coin: coins, decision,
  };
  await db.from("backtest_runs").insert({ params: { kind: "universe_check", ...params } as never, status: "done", summary: summary as never });
  await db.from("desk_config").update({ paper_extra_coins: decision.add }).eq("id", 1);
  const head = `Universe check: ${candidates.length} candidate coins, ${s.all.trades} backtest trades, ${s.all.expectancy_r}R per trade (first 60% ${s.in.expectancy_r}R, last 40% ${s.out.expectancy_r}R), profit factor ${s.all.profit_factor}, max drawdown ${s.all.max_drawdown_pct}%.`;
  await log(db, decision.pass
    ? `${head} PASSED: paper desk now also trades ${decision.add.join(", ") || "none"}${decision.excluded.length ? `; left out ${decision.excluded.map((e) => `${e.coin} (${e.reason})`).join(", ")}` : ""}.`
    : `${head} FAILED (${decision.reasons.join("; ")}): paper desk stays on the top 20.`, decision.pass ? "INFO" : "WARNING");
  return { pass: decision.pass, add: decision.add, excluded: decision.excluded, reasons: decision.reasons, trades: s.all.trades, expectancy_r: s.all.expectancy_r };
}

export async function runUniverseJob(db: DB, budgetMs = 100_000) {
  const deadline = Date.now() + budgetMs;
  const st = await getState(db);
  if (st.phase === "done") return { phase: "done", result: st.result };
  let candidates = st.candidates ?? [];
  if (!candidates.length) {
    candidates = candidateCoins(await latestUniverseRows(db), ALWAYS_COINS);
    await setState(db, { phase: "backfill", candidates, ready: [], failed: {}, started_at: new Date().toISOString() });
    await log(db, `Universe check started: loading full history for ${candidates.length} coins ranked 21–40 (${candidates.join(", ")})`);
  }
  const ready = new Set(st.ready ?? []);
  const failed: Record<string, number> = { ...(st.failed ?? {}) };
  const progress: unknown[] = [];
  for (const coin of candidates) {
    if (ready.has(coin)) continue;
    if (Date.now() > deadline - 20_000) break;
    try {
      const r = await backfillCoin(db, coin, deadline - 15_000);
      progress.push(r);
      if (r.done) ready.add(coin);
    } catch (e) {
      failed[coin] = (failed[coin] ?? 0) + 1;
      if (failed[coin] >= 3) ready.add(coin); // give up; validation leaves it out for lack of history
      await log(db, `Universe backfill ${coin} failed (${failed[coin]}/3): ${e instanceof Error ? e.message : e}`, "WARNING");
    }
  }
  await setState(db, { ready: Array.from(ready), failed, last_run: new Date().toISOString() });
  if (candidates.some((c) => !ready.has(c))) return { phase: "backfill", ready: ready.size, of: candidates.length, progress };
  if (Date.now() > deadline - 40_000) return { phase: "backfill", ready: ready.size, of: candidates.length, note: "validation on next run" };
  const result = await validate(db, candidates);
  await setState(db, { phase: "done", result, done_at: new Date().toISOString() });
  return { phase: "done", result };
}
