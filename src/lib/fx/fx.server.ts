// FX engine I/O (cron /api/cron/fx-tick): quotes, candles for Claude's analysis, bar walk of open paper positions,
// equity snapshot. Paper only; never calls the exchange API.
import type { SupabaseClient } from "@supabase/supabase-js";
import { hlInfo } from "@/lib/hl/hl-api.server";
import { FX_COINS, slipFor, walkBars, type Bar, type Side } from "./fx";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;
const M1 = 60_000, H1 = 3_600_000, D1 = 86_400_000;
type Candle = { t: number; o: string; h: string; l: string; c: string; v: string };

async function syncCandles(db: DB, coin: string) {
  const now = Date.now();
  const { data, error } = await db.rpc("sm_latest_t", { p_coin: coin });
  if (error) throw new Error(`sm_latest_t: ${error.message}`);
  const last = (data ?? {}) as Record<string, string | null>;
  let n = 0;
  for (const [interval, ms, window] of [["1h", H1, 90 * D1], ["1d", D1, 120 * D1]] as const) {
    let start = last[interval] ? Date.parse(last[interval]!) + ms : now - window;
    while (start < now - ms) {
      const batch = await hlInfo<Candle[]>({ type: "candleSnapshot", req: { coin, interval, startTime: start, endTime: now } });
      if (!batch.length) break;
      const rows = batch.filter((k) => k.t + ms <= now)
        .map((k) => ({ coin, interval, t: new Date(k.t).toISOString(), o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v }));
      if (rows.length) {
        const { error: e } = await db.from("hl_candles").upsert(rows as never, { onConflict: "coin,interval,t" });
        if (e) throw new Error(`hl_candles upsert: ${e.message}`);
      }
      n += rows.length;
      const next = batch[batch.length - 1].t + 1;
      if (next <= start) break;
      start = next;
    }
  }
  return n;
}

export async function fxTick(db: DB) {
  const [meta, ctxs] = await hlInfo<[{ universe: { name: string }[] }, Record<string, string | null>[]]>({ type: "metaAndAssetCtxs", dex: "xyz" });
  const now = new Date().toISOString();
  const quotes: Record<string, { mid: number; funding: number }> = {};
  const rows = meta.universe.flatMap((u, i) => {
    if (!(FX_COINS as readonly string[]).includes(u.name)) return [];
    const c = ctxs[i] ?? {};
    const mid = Number(c.midPx ?? c.markPx);
    if (!(mid > 0)) return [];
    quotes[u.name] = { mid, funding: Number(c.funding ?? 0) };
    return [{ coin: u.name, mid, mark: Number(c.markPx) || null, funding_rate: Number(c.funding ?? 0), updated_at: now }];
  });
  if (rows.length) {
    const { error } = await db.from("fx_quotes").upsert(rows as never, { onConflict: "coin" });
    if (error) throw new Error(`fx_quotes upsert: ${error.message}`);
  }

  let candles = 0;
  for (const coin of FX_COINS) candles += await syncCandles(db, coin);

  const { data: open, error: pe } = await db.from("fx_positions").select("*").eq("status", "open");
  if (pe) throw new Error(`fx_positions: ${pe.message}`);
  const { data: books } = await db.from("fx_books").select("id,slip_pct");
  const slipOf = new Map((books ?? []).map((b: { id: string; slip_pct: number }) => [b.id, +b.slip_pct]));
  const closed: string[] = [];
  for (const p of open ?? []) {
    const since = Math.ceil(Date.parse(p.last_checked_at ?? p.opened_at) / M1) * M1;
    const end = Date.now();
    if (since + M1 > end) continue;
    const raw = await hlInfo<Candle[]>({ type: "candleSnapshot", req: { coin: p.coin, interval: "1m", startTime: since, endTime: end } });
    const bars: Bar[] = raw.filter((k) => k.t >= since && k.t + M1 <= end).map((k) => ({ t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c }));
    if (!bars.length) continue;
    const r = walkBars(
      { side: p.side as Side, size: +p.size, notional: +p.notional_usd, stop: +p.stop_px, target: p.target_px != null ? +p.target_px : null, liq: +p.liq_px },
      bars, quotes[p.coin]?.funding ?? 0, slipFor(p.coin, slipOf.get(p.book) ?? 0.02),
    );
    const { error } = await db.rpc("fx_settle", {
      p_position_id: p.id,
      p_funding_add: r.funding,
      p_checked_at: new Date(r.checkedTo!).toISOString(),
      p_exit_px: r.exit?.px ?? undefined,
      p_reason: r.exit?.reason ?? undefined,
      p_closed_at: r.exit ? new Date(r.exit.t + M1).toISOString() : undefined,
    } as never);
    if (error) throw new Error(`fx_settle: ${error.message}`);
    if (r.exit) closed.push(`${p.book} ${p.coin} ${r.exit.reason}`);
  }

  const { data: snap, error: se } = await db.rpc("fx_snapshot");
  if (se) throw new Error(`fx_snapshot: ${se.message}`);
  return { quotes: rows.length, candles, checked: (open ?? []).length, closed, books: snap };
}
