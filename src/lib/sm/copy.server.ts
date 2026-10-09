// Copy backtest I/O: sync hourly candles/funding for the coins graded wallets trade, then run the walk-forward engine
// (copy-engine.ts) and store the result in backtest_runs with params.kind = 'copy'.
import type { SupabaseClient } from "@supabase/supabase-js";
import { hlInfo } from "@/lib/hl/hl-api.server";
import type { Bar } from "@/lib/hl/engine";
import { liquidCoins } from "./deep.server";
import { setJob, smLog } from "./candidates.server";
import { runCopyBacktest, DEFAULT_COPY_PARAMS, type CopyWallet, type CoinHourly } from "./copy-engine";
import type { SmTrade, Series } from "./positions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;
const H1 = 3600_000, D1 = 86400_000;
type Candle = { t: number; o: string; h: string; l: string; c: string; v: string };
type Funding = { coin: string; fundingRate: string; premium: string; time: number };

async function upsert(db: DB, table: "hl_candles" | "hl_funding", rows: unknown[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500) as never, { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

/** Liquid coins that graded, non-high-frequency wallets have traded (sm_copy_coins, migration 0009). */
export async function copyCoins(db: DB): Promise<string[]> {
  const liquid = await liquidCoins(db);
  const { data, error } = await db.rpc("sm_copy_coins", { p_min_trades: 5 });
  if (error) throw new Error(`sm_copy_coins: ${error.message}`);
  return ((data ?? []) as { coin: string }[]).map((r) => r.coin).filter((c) => liquid.has(c));
}

/** Incremental hourly + daily candles and funding for one coin (latest 5000 hours, about 208 days). */
export async function syncHourly(db: DB, coin: string) {
  const now = Date.now();
  const { data: latest, error } = await db.rpc("sm_latest_t", { p_coin: coin });
  if (error) throw new Error(`sm_latest_t: ${error.message}`);
  const last = (latest ?? {}) as Record<string, string | null>;
  const out = { coin, c1h: 0, c1d: 0, funding: 0 };
  for (const [interval, ms, window] of [["1h", H1, 5000 * H1], ["1d", D1, 400 * D1]] as const) {
    let start = last[interval] ? Date.parse(last[interval]!) + ms : now - window;
    while (start < now - ms) {
      const batch = await hlInfo<Candle[]>({ type: "candleSnapshot", req: { coin, interval, startTime: start, endTime: now } });
      if (!batch.length) break;
      const rows = batch.filter((k) => k.t + ms <= now)
        .map((k) => ({ coin, interval, t: new Date(k.t).toISOString(), o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }));
      await upsert(db, "hl_candles", rows, "coin,interval,t");
      if (interval === "1h") out.c1h += rows.length; else out.c1d += rows.length;
      const next = batch[batch.length - 1].t + 1;
      if (next <= start) break;
      start = next;
    }
  }
  let fStart = last.funding ? Date.parse(last.funding) + 1 : now - 5000 * H1;
  while (fStart < now - H1) {
    const batch = await hlInfo<Funding[]>({ type: "fundingHistory", coin, startTime: fStart, endTime: now });
    if (!batch.length) break;
    await upsert(db, "hl_funding", batch.map((f) => ({ coin, t: new Date(f.time).toISOString(), rate: +f.fundingRate, premium: +f.premium })), "coin,t");
    out.funding += batch.length;
    const next = batch[batch.length - 1].time + 1;
    if (next <= fStart) break;
    fStart = next;
  }
  return out;
}

/** Sync stale coins within a time budget. Returns how many are still stale. */
export async function syncCopyData(db: DB, budgetMs = 100_000) {
  const t0 = Date.now();
  const coins = await copyCoins(db);
  const synced: string[] = [];
  let stale = 0;
  for (const coin of coins) {
    const { data } = await db.rpc("sm_latest_t", { p_coin: coin });
    const l1h = (data as Record<string, string | null> | null)?.["1h"];
    if (l1h && Date.now() - Date.parse(l1h) < 3 * H1) continue;
    if (Date.now() - t0 > budgetMs) { stale++; continue; }
    await syncHourly(db, coin);
    synced.push(coin);
  }
  await setJob(db, "copy_sync", { last_run: new Date().toISOString(), coins: coins.length, synced: synced.length, stale });
  return { coins: coins.length, synced, stale };
}

const toSeries = (s: unknown): Series => (Array.isArray(s) ? (s as [number, number][]).map(([t, v]) => [Number(t), Number(v)]) : []);

/** Graded, non-high-frequency wallets with their trades and point-in-time portfolio. */
export async function loadCopyWallets(db: DB): Promise<CopyWallet[]> {
  const { data: sc, error } = await db.from("sm_scores").select("address").eq("fast", false).limit(5000);
  if (error) throw new Error(`sm_scores: ${error.message}`);
  const addrs = (sc ?? []).map((r) => r.address as string);
  const out: CopyWallet[] = [];
  for (let i = 0; i < addrs.length; i += 100) {
    const chunk = addrs.slice(i, i + 100);
    const [{ data: ws }, { data: st }] = await Promise.all([
      db.from("sm_wallets").select("address,sources,first_seen").in("address", chunk),
      db.from("sm_wallet_stats").select("address,portfolio").in("address", chunk),
    ]);
    const trades = new Map<string, SmTrade[]>();
    for (let from = 0; ; from += 1000) {
      const { data: tr, error: e } = await db.from("sm_trades")
        .select("address,coin,side,entry_t,exit_t,entry_px,exit_px,max_notional,net_pnl,fees,hold_h,liquidated")
        .in("address", chunk).order("id").range(from, from + 999);
      if (e) throw new Error(`sm_trades: ${e.message}`);
      for (const t of tr ?? []) {
        const list = trades.get(t.address) ?? trades.set(t.address, []).get(t.address)!;
        list.push({
          coin: t.coin, side: t.side, entry_t: Date.parse(t.entry_t), exit_t: Date.parse(t.exit_t), entry_px: +t.entry_px, exit_px: +t.exit_px,
          max_notional: +t.max_notional, net_pnl: +t.net_pnl, fees: +t.fees, hold_h: +t.hold_h, liquidated: !!t.liquidated,
        });
      }
      if ((tr ?? []).length < 1000) break;
    }
    for (const a of chunk) {
      const w = (ws ?? []).find((x) => x.address === a);
      const p = (st ?? []).find((x) => x.address === a)?.portfolio as { av?: unknown; pnl?: unknown } | undefined;
      out.push({
        address: a, sources: (w?.sources ?? []) as string[], firstSeen: w?.first_seen ? Date.parse(w.first_seen) : undefined,
        trades: trades.get(a) ?? [], portfolio: { av: toSeries(p?.av), pnl: toSeries(p?.pnl) },
      });
    }
  }
  return out;
}

const toBars = (rows: unknown): Bar[] => (Array.isArray(rows) ? (rows as number[][]).map(([t, o, h, l, c]) => ({ t: Number(t), o: Number(o), h: Number(h), l: Number(l), c: Number(c), v: 0 })) : []);

export async function loadCoinHourly(db: DB, coins: string[]): Promise<Map<string, CoinHourly>> {
  const out = new Map<string, CoinHourly>();
  for (const coin of coins) {
    const { data, error } = await db.rpc("sm_coin_hourly", { p_coin: coin });
    if (error) throw new Error(`sm_coin_hourly ${coin}: ${error.message}`);
    const d = (data ?? {}) as { c1h?: unknown; c1d?: unknown; f1h?: unknown };
    const c1h = toBars(d.c1h);
    if (c1h.length < 24 * 30) continue;
    const f1h = new Map<number, number>();
    for (const [t, r] of (Array.isArray(d.f1h) ? (d.f1h as number[][]) : [])) f1h.set(Number(t), Number(r));
    out.set(coin, { coin, c1h, c1d: toBars(d.c1d), f1h });
  }
  return out;
}

/** Run the walk-forward copy backtest and store it. */
export async function runCopy(db: DB) {
  const now = Date.now();
  const { data: run, error } = await db.from("backtest_runs")
    .insert({ params: { kind: "copy", ...DEFAULT_COPY_PARAMS } as never, status: "running" }).select("id").single();
  if (error || !run) throw new Error(`backtest_runs: ${error?.message}`);
  try {
    const [wallets, coins, liquid] = await Promise.all([loadCopyWallets(db), copyCoins(db), liquidCoins(db)]);
    const hourly = await loadCoinHourly(db, coins);
    const res = runCopyBacktest(wallets, hourly, liquid, now, DEFAULT_COPY_PARAMS);
    const rows = res.trades.map((t) => ({
      run_id: run.id, coin: t.coin, setup: `copy_${t.variant}`, side: t.side, sample: t.sample,
      entry_t: new Date(t.entry_t).toISOString(), entry_px: t.entry_px, stop_px: t.stop_px, t1_px: t.t1_px, t2_px: t.t2_px,
      exit_t: new Date(t.exit_t).toISOString(), exit_px: t.exit_px, exit_reason: t.exit_reason,
      gross_r: t.gross_r, fee_r: t.fee_r, funding_r: t.funding_r, net_r: t.net_r, bars_held: t.bars_held,
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const { error: e } = await db.from("backtest_trades").insert(rows.slice(i, i + 500) as never);
      if (e) throw new Error(`backtest_trades: ${e.message}`);
    }
    const summary = {
      kind: "copy", months: res.months, signals: res.signals, wallets: wallets.length,
      wallets_with_trades: wallets.filter((w) => w.trades.length).length, coins_with_data: hourly.size, variants: res.variants,
    };
    await db.from("backtest_runs").update({ status: "done", summary: summary as never }).eq("id", run.id);
    const v = res.variants;
    await smLog(db, `Copy backtest: ${res.months.length} months, ${wallets.length} wallets, ${res.signals} signals · tier A ${v.tier_a?.all.trades ?? 0} trades (exp ${v.tier_a?.all.expectancy_r ?? "-"}R, gate ${v.tier_a?.gate.pass ? "PASS" : "fail"}) · consensus ${v.consensus?.all.trades ?? 0} trades (exp ${v.consensus?.all.expectancy_r ?? "-"}R, gate ${v.consensus?.gate.pass ? "PASS" : "fail"})`);
    return { run_id: run.id, ...summary, variants: Object.fromEntries(Object.entries(res.variants).map(([k, s]) => [k, { all: s.all, gate: s.gate }])) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.from("backtest_runs").update({ status: "error", error: msg.slice(0, 500) }).eq("id", run.id);
    throw e;
  }
}
