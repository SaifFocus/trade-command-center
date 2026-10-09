// Candidate pool: Hyperliquid leaderboard + Invo builder fills (public stats-data files, no auth).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { lz4FrameDecode } from "./lz4";

type DB = SupabaseClient<Database>;
const STATS = "https://stats-data.hyperliquid.xyz/Mainnet";
export const INVO_BUILDER = "0x557edb253b1d7ed5f15b248a5a3fd919fa5d3c81";
const INVO_START = "2025-12-11";

export async function smLog(db: DB, message: string, level = "INFO", metadata?: unknown) {
  await db.from("agent_logs").insert({ agent_name: "SCOUT", message, level, market_id: "swing", metadata: (metadata ?? null) as any });
}
export async function setJob(db: DB, name: string, state: Record<string, unknown>) {
  const { data } = await db.from("sm_jobs").select("state").eq("name", name).maybeSingle();
  await db.from("sm_jobs").upsert({ name, state: { ...((data?.state as any) ?? {}), ...state } as any, updated_at: new Date().toISOString() });
}

/** Streams a JSON body and yields each object inside the top-level array (depth-2 objects). */
async function* streamRows(res: Response): AsyncGenerator<any> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let depth = 0, inStr = false, esc = false, start = -1, scan = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (let i = scan; i < buf.length; i++) {
      const ch = buf[i];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") { if (depth === 2 && ch === "{") start = i; depth++; }
      else if (ch === "}" || ch === "]") {
        depth--;
        if (depth === 2 && ch === "}" && start >= 0) { yield JSON.parse(buf.slice(start, i + 1)); start = -1; }
      }
    }
    if (start >= 0) { buf = buf.slice(start); start = 0; } else buf = "";
    scan = buf.length;
  }
}

function rng(seed: number) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }

async function mergeWallets(db: DB, rows: { address: string; source: string; patch: Record<string, unknown> }[]) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { data: ex } = await db.from("sm_wallets").select("address,sources").in("address", chunk.map((r) => r.address));
    const have = new Map((ex ?? []).map((r) => [r.address, r.sources]));
    const up = chunk.map((r) => ({ address: r.address, sources: Array.from(new Set([...(have.get(r.address) ?? []), r.source])), ...r.patch }));
    const { error } = await db.from("sm_wallets").upsert(up as any, { onConflict: "address" });
    if (error) throw new Error(`sm_wallets upsert: ${error.message}`);
  }
}

export async function pullLeaderboard(db: DB) {
  const vres = await fetch(`${STATS}/vaults`);
  const vaults = new Set<string>();
  if (vres.ok) for await (const v of streamRows(vres)) { const a = v?.summary?.vaultAddress; if (a) vaults.add(String(a).toLowerCase()); }
  const res = await fetch(`${STATS}/leaderboard`);
  if (!res.ok) throw new Error(`leaderboard HTTP ${res.status}`);
  type Row = { address: string; name: string | null; av: number; mVlm: number; aVlm: number; aPnl: number };
  const pass: Row[] = [];
  let total = 0, keys: string[] | null = null;
  for await (const r of streamRows(res)) {
    total++;
    if (!keys) keys = Object.keys(r);
    const wp = Object.fromEntries((r.windowPerformances ?? []) as [string, any][]);
    const row: Row = {
      address: String(r.ethAddress).toLowerCase(), name: r.displayName ?? null, av: +r.accountValue,
      mVlm: +(wp.month?.vlm ?? 0), aVlm: +(wp.allTime?.vlm ?? 0), aPnl: +(wp.allTime?.pnl ?? 0),
    };
    if (row.av >= 5000 && row.aVlm >= 1_000_000 && row.mVlm > 0 && !vaults.has(row.address)) pass.push(row);
  }
  const pick = new Map<string, Row>();
  [...pass].sort((a, b) => b.mVlm - a.mVlm).slice(0, 300).forEach((r) => pick.set(r.address, r));
  [...pass].sort((a, b) => b.aPnl - a.aPnl).slice(0, 300).forEach((r) => pick.set(r.address, r));
  const rest = pass.filter((r) => !pick.has(r.address));
  const rand = rng(Number(new Date().toISOString().slice(0, 10).replace(/-/g, "")));
  for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
  rest.slice(0, 200).forEach((r) => pick.set(r.address, r));
  await mergeWallets(db, Array.from(pick.values()).map((r) => ({
    address: r.address, source: "leaderboard",
    patch: { display_name: r.name, account_value: r.av, lb_month_vlm: r.mVlm, lb_alltime_pnl: r.aPnl },
  })));
  const out = { rows: total, keys, vaults_excluded: vaults.size, passing_floor: pass.length, selected: pick.size };
  await setJob(db, "leaderboard", { ...out, at: new Date().toISOString() });
  await smLog(db, `Leaderboard pulled: ${total} rows, ${pass.length} pass floor, ${pick.size} selected. Keys: ${keys?.join(",")}`);
  return out;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** Ingest one Invo builder-fills day: per-wallet fills, opens (closed_pnl = 0 fills, one per coin+side cluster) and originated clusters. */
export async function ingestInvoDay(db: DB, day: string) {
  const url = `${STATS}/builder_fills/${INVO_BUILDER}/${day.replace(/-/g, "")}.csv.lz4`;
  const res = await fetch(url);
  if (res.status === 404 || res.status === 403) {
    await db.from("sm_invo_days").upsert({ day, rows: 0, status: "missing" });
    return { day, rows: 0, status: "missing" as const };
  }
  if (!res.ok) throw new Error(`invo ${day} HTTP ${res.status}`);
  const text = new TextDecoder().decode(lz4FrameDecode(new Uint8Array(await res.arrayBuffer())));
  const lines = text.split("\n");
  const header = lines[0].trim().split(",");
  const ix = (k: string) => header.indexOf(k);
  const [iT, iU, iC, iS, iP] = [ix("time"), ix("user"), ix("coin"), ix("side"), ix("closed_pnl")];
  if (iT < 0 || iU < 0 || iC < 0 || iS < 0) throw new Error(`invo header unexpected: ${lines[0]}`);
  const st = new Map<string, { fills: number; opens: number; originated: number }>();
  const get = (u: string) => st.get(u) ?? st.set(u, { fills: 0, opens: 0, originated: 0 }).get(u)!;
  const opens: { t: number; u: string; k: string }[] = [];
  let n = 0;
  for (let i = 1; i < lines.length; i++) {
    const l = lines[i]; if (!l) continue;
    const c = l.split(",");
    const u = c[iU]?.toLowerCase(); if (!u) continue;
    n++;
    get(u).fills++;
    if (iP >= 0 && Number(c[iP]) === 0) opens.push({ t: Date.parse(c[iT]), u, k: `${c[iC]}|${c[iS]}` });
  }
  opens.sort((a, b) => a.t - b.t);
  const clusterStart = new Map<string, { t: number; members: Set<string> }>();
  for (const o of opens) {
    let cl = clusterStart.get(o.k);
    if (!cl || o.t - cl.t > 30 * 60_000) {
      cl = { t: o.t, members: new Set() };
      clusterStart.set(o.k, cl);
      get(o.u).originated++;
    }
    if (!cl.members.has(o.u)) { cl.members.add(o.u); get(o.u).opens++; }
  }
  const rows = Array.from(st, ([address, v]) => ({ day, address, ...v }));
  for (let i = 0; i < rows.length; i += 1000) {
    const { error } = await db.from("sm_invo_daily").upsert(rows.slice(i, i + 1000), { onConflict: "day,address" });
    if (error) throw new Error(`sm_invo_daily: ${error.message}`);
  }
  await db.from("sm_invo_days").upsert({ day, rows: n, status: "ok" });
  const { data: j } = await db.from("sm_jobs").select("state").eq("name", "invo").maybeSingle();
  if (!(j?.state as any)?.header) await smLog(db, `Invo CSV header: ${lines[0].trim()}`);
  await setJob(db, "invo", { header });
  return { day, rows: n, status: "ok" as const };
}

/** Ingest missing days among the last 60 (oldest first) within a time budget, then refresh Invo candidates. */
export async function ingestInvo(db: DB, budgetMs = 200_000) {
  const t0 = Date.now();
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const days: string[] = [];
  for (let d = 60; d >= 1; d--) { const x = ymd(new Date(today.getTime() - d * 86400_000)); if (x >= INVO_START) days.push(x); }
  const { data: done } = await db.from("sm_invo_days").select("day,status").in("day", days);
  const have = new Set((done ?? []).filter((r) => r.status === "ok" || (r.status === "missing" && r.day < ymd(new Date(today.getTime() - 2 * 86400_000)))).map((r) => r.day));
  const ingested: string[] = [];
  for (const d of days) {
    if (have.has(d)) continue;
    if (Date.now() - t0 > budgetMs) break;
    const r = await ingestInvoDay(db, d);
    ingested.push(`${d}:${r.rows}`);
  }
  const remaining = days.filter((d) => !have.has(d)).length - ingested.length;
  const cands = await refreshInvoCandidates(db, days[0]);
  await setJob(db, "invo", { last_run: new Date().toISOString(), remaining_days: remaining, candidates: cands });
  if (ingested.length) await smLog(db, `Invo ingest: ${ingested.length} day(s) (${ingested.join(", ")}), ${remaining} left, ${cands} candidates`);
  return { ingested, remaining, candidates: cands };
}

async function refreshInvoCandidates(db: DB, since: string) {
  const rows: { address: string; fills: number; opens: number; originated: number }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.rpc("sm_invo_agg2", { p_since: since, p_min: 30 }).range(from, from + 999);
    if (error) throw new Error(`sm_invo_agg2: ${error.message}`);
    rows.push(...((data ?? []) as any[]));
    if ((data ?? []).length < 1000) break;
  }
  await mergeWallets(db, rows.map((r) => ({
    address: r.address, source: "invo",
    patch: { invo_fills_60d: Number(r.fills), invo_opens_60d: Number(r.opens), invo_originator_share: Number(r.opens) ? Math.min(1, Number(r.originated) / Number(r.opens)) : null },
  })));
  return rows.length;
}
