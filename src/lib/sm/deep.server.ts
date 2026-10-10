// Deep dive queue: portfolio + 180d fills per wallet -> trades, metrics, score; then rebuild the watchlist.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { hlInfo } from "@/lib/hl/hl-api.server";
import { fillsToTrades, computeMetrics, type Fill, type Portfolio, type Series, type SmTrade } from "./positions";
import { scoreWallet } from "./score";
import { setJob, smLog } from "./candidates.server";

type DB = SupabaseClient<Database>;
const DAY = 86400_000;

export async function liquidCoins(db: DB): Promise<Set<string>> {
  const { data: snap } = await db.from("hl_universe").select("snapshot_at").order("snapshot_at", { ascending: false }).limit(1);
  if (!snap?.[0]) return new Set();
  const { data } = await db.from("hl_universe").select("coin,day_ntl_vlm").eq("snapshot_at", snap[0].snapshot_at).gte("day_ntl_vlm", 10_000_000);
  return new Set((data ?? []).map((r) => r.coin));
}

export function parsePortfolio(raw: [string, { accountValueHistory: [number, string][]; pnlHistory: [number, string][] }][]): Portfolio {
  const m = Object.fromEntries(raw);
  const conv = (s?: [number, string][]): Series => (s ?? []).map(([t, v]) => [t, +v]);
  const all = m.perpAllTime ?? m.allTime, mon = m.perpMonth ?? m.month, wk = m.perpWeek ?? m.week;
  const merge = (k: "accountValueHistory" | "pnlHistory") => {
    const a = conv(all?.[k]), b = conv(mon?.[k]), c = conv(wk?.[k]);
    const bStart = b[0]?.[0] ?? Infinity, cStart = c[0]?.[0] ?? Infinity;
    // pnl series from different windows have different baselines: rebase finer windows onto the all-time series.
    if (k === "pnlHistory") {
      const rebase = (s: Series, start: number): Series => {
        let base = 0; for (const [t, v] of a) if (t <= start) base = v;
        const off = base - (s[0]?.[1] ?? 0);
        return s.map(([t, v]) => [t, v + off]);
      };
      const b2 = rebase(b, bStart);
      let baseC = 0; for (const [t, v] of b2) if (t <= cStart) baseC = v;
      const c2 = c.map(([t, v]) => [t, v + baseC - (c[0]?.[1] ?? 0)] as [number, number]);
      return [...a.filter(([t]) => t < bStart), ...b2.filter(([t]) => t < cStart), ...c2];
    }
    return [...a.filter(([t]) => t < bStart), ...b.filter(([t]) => t < cStart), ...c];
  };
  return { av: merge("accountValueHistory"), pnl: merge("pnlHistory") };
}

async function fetchFills(address: string, from: number, to: number): Promise<Fill[]> {
  const out: Fill[] = [];
  let start = from;
  for (let page = 0; page < 6; page++) {
    const batch = await hlInfo<Fill[]>({ type: "userFillsByTime", user: address, startTime: start, endTime: to, aggregateByTime: true });
    if (!batch.length) break;
    out.push(...batch);
    if (batch.length < 2000) break;
    const next = Math.max(...batch.map((f) => f.time)) + 1;
    if (next <= start) break;
    start = next;
  }
  return out;
}

/** Most recent 2,000 fills in under this window = trades too often to follow on a swing timeframe. */
const HIGH_FREQ_WINDOW = 20 * DAY;

export async function deepDive(db: DB, address: string, liquid: Set<string>, firstSeen?: number) {
  const now = Date.now();
  // Fast path first (weight ~120): whales with 10,000+ fills would otherwise cost ~720 weight each and stall the queue.
  const recent = await hlInfo<Fill[]>({ type: "userFills", user: address, aggregateByTime: true });
  if (recent.length >= 2000) {
    const oldest = Math.min(...recent.map((f) => f.time));
    if (now - oldest < HIGH_FREQ_WINDOW) {
      const days = Math.round(((now - oldest) / DAY) * 10) / 10;
      const { error } = await db.from("sm_scores").upsert({
        address, computed_at: new Date().toISOString(), score: 0, base: null, cap: null, tier: null, eligible: false, fast: true,
        filters: { high_frequency: false } as any, components: { recent_2000_fills_days: days } as any,
      });
      if (error) throw new Error(`sm_scores: ${error.message}`);
      return { trades: 0, fills: recent.length, score: 0, tier: null, skipped: `high frequency: 2000 fills in ${days} days` };
    }
  }
  const raw = await hlInfo<any>({ type: "portfolio", user: address });
  const portfolio = parsePortfolio(raw);
  const fills = await fetchFills(address, now - 180 * DAY, now);
  const trades = fillsToTrades(fills);
  const m = computeMetrics(trades, portfolio, now, liquid, firstSeen);
  const s = scoreWallet(m, now);

  await db.from("sm_trades").delete().eq("address", address);
  const rows = trades.map((t) => ({ address, ...t, entry_t: new Date(t.entry_t).toISOString(), exit_t: new Date(t.exit_t).toISOString() }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("sm_trades").insert(rows.slice(i, i + 500));
    if (error) throw new Error(`sm_trades: ${error.message}`);
  }
  // keep a compact portfolio (<= ~400 points per series) for the equity curve and point-in-time backtests
  const thin = (s: Series) => { const k = Math.max(1, Math.ceil(s.length / 400)); return s.filter((_, i) => i % k === 0 || i === s.length - 1); };
  const iso = (x: number | null) => (x == null ? null : new Date(x).toISOString());
  const { error: e1 } = await db.from("sm_wallet_stats").upsert({
    address, computed_at: new Date().toISOString(), ...m, last_trade_at: iso(m.last_trade_at),
    portfolio: { av: thin(portfolio.av), pnl: thin(portfolio.pnl) } as any, metrics: { fills: fills.length } as any,
  });
  if (e1) throw new Error(`sm_wallet_stats: ${e1.message}`);
  const { error: e2 } = await db.from("sm_scores").upsert({
    address, computed_at: new Date().toISOString(), score: s.score, base: s.base, cap: s.cap, tier: s.tier,
    eligible: s.eligible, fast: s.fast, filters: s.filters as any, components: s.components as any,
  });
  if (e2) throw new Error(`sm_scores: ${e2.message}`);
  return { trades: trades.length, fills: fills.length, score: s.score, tier: s.tier };
}

/** Process due wallets until the time budget is used. Resumable: progress lives in sm_wallets.next_due_at/status. */
export async function processQueue(db: DB, budgetMs = 230_000) {
  const t0 = Date.now();
  const liquid = await liquidCoins(db);
  let done = 0, failed = 0;
  while (Date.now() - t0 < budgetMs) {
    // Priority order and Invo filter live in the sm_due_wallets() SQL function (migration 0008).
    const { data: due } = await (db.rpc as any)("sm_due_wallets", { p_limit: 5 }) as { data: { address: string; first_seen: string }[] | null };
    if (!due?.length) break;
    for (const w of due) {
      if (Date.now() - t0 > budgetMs) break;
      const { data: sc } = await db.from("sm_scores").select("watchlist").eq("address", w.address).maybeSingle();
      try {
        await deepDive(db, w.address, liquid, Date.parse(w.first_seen));
        const next = Date.now() + (sc?.watchlist ? 1 : 7) * DAY;
        await db.from("sm_wallets").update({ status: "graded", last_deep_dive_at: new Date().toISOString(), next_due_at: new Date(next).toISOString(), error: null }).eq("address", w.address);
        done++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await db.from("sm_wallets").update({ status: "error", error: msg.slice(0, 300), next_due_at: new Date(Date.now() + DAY).toISOString() }).eq("address", w.address);
        failed++;
        if (/rate budget|too many retries/.test(msg)) break;
      }
    }
  }
  const wl = await rebuildWatchlist(db);
  const { data: queue } = await (db.rpc as any)("sm_due_count") as { data: number | null };
  const { count: graded } = await db.from("sm_scores").select("address", { count: "exact", head: true });
  const rate = done / Math.max(1, (Date.now() - t0) / 60_000);
  await setJob(db, "deep_dive", { last_run: new Date().toISOString(), processed: done, failed, queue, graded, watchlist: wl, per_min: Math.round(rate * 10) / 10 });
  return { processed: done, failed, queue, graded, watchlist: wl };
}

export const PRACTICE_SLOTS = 20;
const practiceOk = (f: unknown) => {
  const x = (f ?? {}) as Record<string, boolean>;
  return !!(x.swing_hold && x.recent && x.leverage_liq && x.liquid);
};

/**
 * Top 30 tier A/B by score; Invo wallets with originator share < 50% rank after the rest.
 * Practice (paper only): up to 20 more swing traders that pass the style and safety filters (hold ≥ 24 h, traded in the last
 * 14 days, leverage ≤ 10 without liquidations, liquid coins) but not yet the trade-count/accuracy bar. Their opens become
 * 'practice_follow' signals, which never trade real money.
 */
export async function rebuildWatchlist(db: DB) {
  const [{ data: sc }, { data: pc }] = await Promise.all([
    db.from("sm_scores").select("address,score,tier").not("tier", "is", null).order("score", { ascending: false }).limit(500),
    db.from("sm_scores").select("address,score,filters").is("tier", null).eq("fast", false).gte("score", 3).order("score", { ascending: false }).limit(1000),
  ]);
  const practicePool = (pc ?? []).filter((r) => practiceOk(r.filters));
  const addrs = [...(sc ?? []), ...practicePool].map((r) => r.address);
  const { data: ws } = addrs.length ? await db.from("sm_wallets").select("address,sources,invo_originator_share").in("address", addrs) : { data: [] };
  const wm = new Map((ws ?? []).map((w) => [w.address, w]));
  const penal = (a: string) => { const w = wm.get(a); return w?.sources.includes("invo") && !w.sources.includes("leaderboard") && (w.invo_originator_share ?? 0) < 0.5 ? 1 : 0; };
  const ranked = [...(sc ?? [])].sort((a, b) => penal(a.address) - penal(b.address) || +b.score - +a.score);
  const top = new Set(ranked.slice(0, 30).map((r) => r.address));
  const practice = practicePool.filter((r) => !top.has(r.address))
    .sort((a, b) => penal(a.address) - penal(b.address) || +b.score - +a.score).slice(0, PRACTICE_SLOTS).map((r) => r.address);
  // Flip only what changed, so the tracker never sees a moment with the flags all off (it would drop and re-read
  // every position as new).
  const { data: cur } = await db.from("sm_scores").select("address,practice").eq("watchlist", true);
  const want = new Map<string, boolean>([...Array.from(top).map((a) => [a, false] as [string, boolean]), ...practice.map((a) => [a, true] as [string, boolean])]);
  const drop = (cur ?? []).filter((r) => !want.has(r.address)).map((r) => r.address);
  const toReal = Array.from(want).filter(([a, p]) => !p && (cur ?? []).find((r) => r.address === a)?.practice !== false).map(([a]) => a);
  const toPractice = Array.from(want).filter(([a, p]) => p && (cur ?? []).find((r) => r.address === a)?.practice !== true).map(([a]) => a);
  if (drop.length) await db.from("sm_scores").update({ watchlist: false, practice: false }).in("address", drop);
  if (toReal.length) await db.from("sm_scores").update({ watchlist: true, practice: false }).in("address", toReal);
  if (toPractice.length) await db.from("sm_scores").update({ watchlist: true, practice: true }).in("address", toPractice);
  const { rebuildMimic } = await import("./mimic.server");
  await rebuildMimic(db as never);
  // Wallets no longer tracked get a fresh baseline if they come back (see trackWatchlist).
  await db.from("sm_scores").update({ tracked_at: null }).eq("watchlist", false).eq("mirror", false).not("tracked_at", "is", null);
  return top.size;
}

export type { SmTrade };
