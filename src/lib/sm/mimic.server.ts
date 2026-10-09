// Mimic simulator I/O (see mimic.ts). Picks the mirrored wallets after each deep-dive batch and opens/closes
// $100 virtual copies from the position changes trackWatchlist sees every 5 minutes. Paper only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { MIMIC, pickMimic, mimicEntry, mimicExit, type MimicCandidate } from "./mimic";

// mimic_trades is not in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, any, any>;
export type TrackEvent = { address: string; coin: string; side: string; kind: string; entry_px?: number | null; leverage?: number | null };

export async function rebuildMimic(db: DB): Promise<number> {
  const since = new Date(Date.now() - MIMIC.activeDays * 86400_000).toISOString();
  const { data: st } = await db.from("sm_wallet_stats")
    .select("address,trades,profit_factor,ret_30,ret_90,last_trade_at,liquid_share")
    .gte("last_trade_at", since).gte("trades", MIMIC.minTrades).gte("profit_factor", MIMIC.minProfitFactor).gte("liquid_share", MIMIC.minLiquidShare)
    .order("profit_factor", { ascending: false }).limit(300);
  const addrs = (st ?? []).map((r) => r.address as string);
  let pick: string[] = [];
  if (addrs.length) {
    const [{ data: ws }, { data: sc }] = await Promise.all([
      db.from("sm_wallets").select("address,sources").in("address", addrs),
      db.from("sm_scores").select("address,score").in("address", addrs),
    ]);
    const src = new Map((ws ?? []).map((w) => [w.address as string, (w.sources ?? []) as string[]]));
    const score = new Map((sc ?? []).map((s) => [s.address as string, Number(s.score)]));
    const cands: MimicCandidate[] = (st ?? []).map((r) => ({
      address: r.address, sources: src.get(r.address) ?? [], score: score.get(r.address) ?? 0,
      trades: r.trades, profit_factor: r.profit_factor == null ? null : Number(r.profit_factor),
      ret_30: r.ret_30 == null ? null : Number(r.ret_30), ret_90: r.ret_90 == null ? null : Number(r.ret_90),
      last_trade_at: r.last_trade_at ? Date.parse(r.last_trade_at) : null, liquid_share: r.liquid_share == null ? null : Number(r.liquid_share),
    }));
    pick = pickMimic(cands, Date.now());
  }
  await db.from("sm_scores").update({ mirror: false }).eq("mirror", true);
  if (pick.length) await db.from("sm_scores").update({ mirror: true }).in("address", pick);
  return pick.length;
}

/** Apply this run's position changes to the virtual copies. Closes run before opens so a flip closes then reopens. */
export async function mimicStep(db: DB, events: TrackEvent[], mirror: Set<string>, mids: Record<string, string>, liquid: Set<string>) {
  const out = { opened: [] as string[], closed: [] as string[] };
  const nowIso = new Date().toISOString();
  const close = async (t: { id: string; side: string; entry_px: number; fees_usd: number; notional_usd: number; coin: string; address: string }, reason: string) => {
    const mark = Number(mids[t.coin]);
    if (!(mark > 0)) return;
    const x = mimicExit({ side: t.side, entry_px: Number(t.entry_px), fees_usd: Number(t.fees_usd), notional_usd: Number(t.notional_usd) }, mark);
    await db.from("mimic_trades").update({ status: "closed", closed_at: nowIso, exit_px: x.exit, exit_reason: reason, fees_usd: x.fees, net_usd: x.net, net_pct: x.pct }).eq("id", t.id);
    out.closed.push(`${t.coin} ${x.pct.toFixed(2)}%`);
  };
  for (const e of events) {
    if (e.kind !== "close" || !mirror.has(e.address)) continue;
    const { data: open } = await db.from("mimic_trades").select("*").eq("status", "open").eq("address", e.address).eq("coin", e.coin).eq("side", e.side);
    for (const t of open ?? []) await close(t, "trader_closed");
  }
  for (const e of events) {
    if (e.kind !== "open" || !mirror.has(e.address) || !liquid.has(e.coin)) continue;
    const mark = Number(mids[e.coin]);
    if (!(mark > 0)) continue;
    const { data: existing } = await db.from("mimic_trades").select("id").eq("status", "open").eq("address", e.address).eq("coin", e.coin).limit(1);
    if (existing?.length) continue;
    const m = mimicEntry(mark, e.side);
    await db.from("mimic_trades").insert({
      address: e.address, coin: e.coin, side: e.side, entry_px: m.entry, their_entry_px: e.entry_px ?? null, their_leverage: e.leverage ?? null,
      notional_usd: MIMIC.notionalUsd, fees_usd: m.fees,
    });
    out.opened.push(`${e.coin} ${e.side}`);
  }
  // Copies of wallets that left the mirror set are closed at the mark.
  const { data: orphans } = await db.from("mimic_trades").select("*").eq("status", "open");
  for (const t of orphans ?? []) if (!mirror.has(t.address)) await close(t, "untracked");
  return out;
}
