import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { hlInfo } from "./hl-api.server";

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

/** Snapshot the universe; returns the coin list (top 20 by volume + always-on coins). */
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
  const top = [...rows].sort((a, b) => b.day_ntl_vlm - a.day_ntl_vlm).slice(0, 20).map((r) => r.coin);
  const listed = new Set(rows.map((r) => r.coin));
  return Array.from(new Set([...top, ...ALWAYS_COINS.filter((c) => listed.has(c))]));
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

export async function syncAll(db: DB) {
  const coins = await syncUniverse(db);
  const results: CoinSyncResult[] = [];
  for (const c of coins) results.push(await syncCoin(db, c));
  return { coins, results };
}
