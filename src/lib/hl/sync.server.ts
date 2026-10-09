import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { hlInfo } from "./hl-api.server";
import { baseCoins } from "./universe";

type DB = SupabaseClient<Database>;

export const ALWAYS_COINS = ["BTC", "ETH", "SOL", "HYPE", "DOGE"];
export const INTERVAL_MS: Record<string, number> = { "4h": 4 * 3600_000, "1d": 86400_000 };
const MAX_CANDLES = 5000;

type Meta = { universe: { name: string; maxLeverage: number; isDelisted?: boolean }[] };
type Ctx = { dayNtlVlm: string; openInterest: string; funding: string; markPx: string };
type Candle = { t: number; o: string; h: string; l: string; c: string; v: string };
type Funding = { coin: string; fundingRate: string; premium: string; time: number };

async function upsert(db: DB, table: "hl_candles" | "hl_funding" | "hl_universe", rows: any[], onConflict: string) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 500), { onConflict });
    if (error) throw new Error(`${table} upsert: ${error.message}`);
  }
}

/** Snapshot the universe; returns the base coin list (top 20 by volume + always-on coins). */
export async function syncUniverse(db: DB): Promise<string[]> {
  const [meta, ctxs] = await hlInfo<[Meta, Ctx[]]>({ type: "metaAndAssetCtxs" });
  const snapshot_at = new Date().toISOString();
  const rows = meta.universe
    .map((u, i) => ({ u, c: ctxs[i] }))
    .filter(({ u, c }) => c && !u.isDelisted)
    .map(({ u, c }) => ({
      coin: u.name,
      day_ntl_vlm: Number(c.dayNtlVlm),
      open_interest: Number(c.openInterest),
      funding: Number(c.funding),
      mark_px: c.markPx == null ? null : Number(c.markPx),
      max_leverage: u.maxLeverage,
      snapshot_at,
    }));
  await upsert(db, "hl_universe", rows, "coin,snapshot_at");
  return baseCoins(rows, ALWAYS_COINS);
}

export type CoinSyncResult = { coin: string; candles4h: number; candles1d: number; funding: number };

/** Sync one coin. Incremental from the latest stored t; full 5000-bar window otherwise. Only closed candles are stored. */
export async function syncCoin(db: DB, coin: string): Promise<CoinSyncResult> {
  const now = Date.now();
  const { data: latest, error } = await db.rpc("hl_latest_t", { p_coin: coin });
  if (error) throw new Error(`hl_latest_t: ${error.message}`);
  const last = (latest ?? {}) as Record<string, string | null>;
  const out: CoinSyncResult = { coin, candles4h: 0, candles1d: 0, funding: 0 };

  for (const interval of ["4h", "1d"] as const) {
    const ms = INTERVAL_MS[interval];
    let start = last[interval] ? new Date(last[interval]!).getTime() + ms : now - MAX_CANDLES * ms;
    while (start < now) {
      const batch = await hlInfo<Candle[]>({ type: "candleSnapshot", req: { coin, interval, startTime: start, endTime: now } });
      if (!batch.length) break;
      const rows = batch
        .filter((k) => k.t + ms <= now)
        .map((k) => ({ coin, interval, t: new Date(k.t).toISOString(), o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }));
      await upsert(db, "hl_candles", rows, "coin,interval,t");
      if (interval === "4h") out.candles4h += rows.length;
      else out.candles1d += rows.length;
      const next = batch[batch.length - 1].t + 1;
      if (next <= start) break;
      start = next;
    }
  }

  let fStart = last.funding ? new Date(last.funding).getTime() + 1 : now - MAX_CANDLES * INTERVAL_MS["4h"];
  while (fStart < now) {
    const batch = await hlInfo<Funding[]>({ type: "fundingHistory", coin, startTime: fStart, endTime: now });
    if (!batch.length) break;
    const rows = batch.map((f) => ({ coin, t: new Date(f.time).toISOString(), rate: +f.fundingRate, premium: +f.premium }));
    await upsert(db, "hl_funding", rows, "coin,t");
    out.funding += rows.length;
    const next = batch[batch.length - 1].time + 1;
    if (next <= fStart) break;
    fStart = next;
  }
  return out;
}

/** Base coins plus validated extra coins (desk_config.paper_extra_coins), incremental. */
export async function syncAll(db: DB, extras: string[] = []) {
  const coins = Array.from(new Set([...(await syncUniverse(db)), ...extras]));
  const results: CoinSyncResult[] = [];
  for (const c of coins) results.push(await syncCoin(db, c));
  return { coins, results };
}

const H1 = 3600_000;
const D1 = INTERVAL_MS["1d"];

async function earliestT(db: DB, table: "hl_candles" | "hl_funding", coin: string, interval?: string): Promise<number | null> {
  const { data, error } = table === "hl_candles"
    ? await db.from("hl_candles").select("t").eq("coin", coin).eq("interval", interval ?? "4h").order("t", { ascending: true }).limit(1)
    : await db.from("hl_funding").select("t").eq("coin", coin).order("t", { ascending: true }).limit(1);
  if (error) throw new Error(`${table} earliest ${coin}: ${error.message}`);
  return data?.[0]?.t ? Date.parse(data[0].t) : null;
}

async function fetchCandles(db: DB, coin: string, interval: "4h" | "1d", startTime: number, endTime: number): Promise<number> {
  const ms = INTERVAL_MS[interval];
  const now = Date.now();
  const batch = await hlInfo<Candle[]>({ type: "candleSnapshot", req: { coin, interval, startTime, endTime } });
  const rows = batch.filter((k) => k.t + ms <= now)
    .map((k) => ({ coin, interval, t: new Date(k.t).toISOString(), o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }));
  await upsert(db, "hl_candles", rows, "coin,interval,t");
  return rows.length;
}

async function fetchFunding(db: DB, coin: string, startTime: number, endTime: number): Promise<number> {
  const batch = await hlInfo<Funding[]>({ type: "fundingHistory", coin, startTime, endTime });
  await upsert(db, "hl_funding", batch.map((f) => ({ coin, t: new Date(f.time).toISOString(), rate: +f.fundingRate, premium: +f.premium })), "coin,t");
  return batch.length;
}

/**
 * Full history for a coin the desk has not tracked before: 4h back ~833 days, daily back to listing, funding back to the
 * first 4h bar. Funding is filled backwards from the earliest stored row, so a call cut short by the deadline leaves no gap
 * and the next call carries on. Ends with the normal forward sync.
 */
export async function backfillCoin(db: DB, coin: string, deadline: number) {
  const out = { coin, done: false, c4h: 0, c1d: 0, funding: 0 };
  const now = Date.now();
  let e4 = await earliestT(db, "hl_candles", coin, "4h");
  if (e4 == null) {
    out.c4h += await fetchCandles(db, coin, "4h", now - MAX_CANDLES * INTERVAL_MS["4h"], now);
    e4 = await earliestT(db, "hl_candles", coin, "4h");
    if (e4 == null) return { ...out, done: true };
  }
  const e1 = await earliestT(db, "hl_candles", coin, "1d");
  if (e1 == null || e1 > e4 + D1) out.c1d += await fetchCandles(db, coin, "1d", now - MAX_CANDLES * D1, e1 ?? now);

  let f = await earliestT(db, "hl_funding", coin);
  if (f == null) {
    out.funding += await fetchFunding(db, coin, now - 500 * H1, now);
    f = await earliestT(db, "hl_funding", coin);
  }
  let fundingDone = f == null || f <= e4 + 8 * H1;
  while (!fundingDone && Date.now() < deadline) {
    const n = await fetchFunding(db, coin, f! - 500 * H1, f! - 1);
    out.funding += n;
    const next = await earliestT(db, "hl_funding", coin);
    if (!n || next == null || next >= f!) fundingDone = true; // nothing older exists
    else { f = next; fundingDone = f <= e4 + 8 * H1; }
  }
  if (!fundingDone) return out;
  const fwd = await syncCoin(db, coin);
  out.c4h += fwd.candles4h; out.c1d += fwd.candles1d; out.funding += fwd.funding;
  return { ...out, done: true };
}
