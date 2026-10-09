import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { runBacktest, summarize, type Bar, type CoinData, type Params } from "./engine";

type DB = SupabaseClient<Database>;

export const CONFIGS: Params[] = [
  { name: "hyperliquid_direct", feePct: 0.045, slipPct: 0.05 },
  { name: "via_invo", feePct: 0.0768, slipPct: 0.05 },
];

async function latestCoins(db: DB): Promise<string[]> {
  // Coins with a recent closed daily candle (small result set; avoids the 1000-row API cap).
  const since = new Date(Date.now() - 5 * 86400_000).toISOString();
  const { data, error } = await db.from("hl_candles").select("coin").eq("interval", "1d").gte("t", since).limit(1000);
  if (error) throw new Error(error.message);
  return Array.from(new Set((data ?? []).map((r) => r.coin))).sort();
}

export async function loadCoinData(db: DB): Promise<CoinData[]> {
  const coins = await latestCoins(db);
  const out: CoinData[] = [];
  for (const coin of coins) {
    const { data, error } = await db.rpc("hl_backtest_data", { p_coin: coin });
    if (error) throw new Error(`hl_backtest_data(${coin}): ${error.message}`);
    const d = data as { c4h: any[][]; c1d: any[][]; f4h: any[][] };
    const toBar = (r: any[]): Bar => ({ t: Number(r[0]), o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] });
    out.push({
      coin,
      c4h: d.c4h.map(toBar),
      c1d: d.c1d.map(toBar),
      f4h: new Map(d.f4h.map((r) => [Number(r[0]), { s: +r[1], n: +r[2] }])),
    });
  }
  return out;
}

export async function runAndStore(db: DB, params: Params, data?: CoinData[]) {
  const { data: run, error } = await db.from("backtest_runs").insert({ params: params as any, status: "running" }).select("id").single();
  if (error || !run) throw new Error(`backtest_runs insert: ${error?.message}`);
  try {
    const coins = data ?? (await loadCoinData(db));
    const res = runBacktest(coins, params);
    const summary = {
      config: params.name,
      range: { start: new Date(res.startT).toISOString(), split: new Date(res.splitT).toISOString(), end: new Date(res.endT).toISOString() },
      coins: coins.map((c) => c.coin),
      ...summarize(res.trades),
    };
    const rows = res.trades.map((t) => ({
      ...t, run_id: run.id,
      entry_t: new Date(t.entry_t).toISOString(), exit_t: new Date(t.exit_t).toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e } = await db.from("backtest_trades").insert(rows.slice(i, i + 500));
      if (e) throw new Error(`backtest_trades insert: ${e.message}`);
    }
    await db.from("backtest_runs").update({ status: "done", summary: summary as any }).eq("id", run.id);
    return { id: run.id, summary };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("backtest_runs").update({ status: "error", error: msg }).eq("id", run.id);
    throw e;
  }
}
