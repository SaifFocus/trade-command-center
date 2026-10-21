// Invo bridge, APEX side. The bridge program on the owner's computer (bridge/ in the repo, installed in
// Documents\APEX Invo Bridge) keeps a browser logged into Invo, opens each followed portfolio and posts the JSON the Invo
// app downloaded. Parsing is content-based (invo-parse.ts), so APEX never calls Invo and never holds Invo credentials.
// Followed Invo portfolios are pseudo-wallets "invo:<portfolio id>" in sm_wallets (sources 'invo_scout' + 'invo_bridge'),
// so the existing tracker, follow signals, follow exits and Mimic copies handle them like Hyperliquid wallets. Paper only.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { hlInfo } from "@/lib/hl/hl-api.server";
import { parseVisit, diffInvo, normalizeCoin, type Capture } from "./invo-parse";
import { mimicStep, mimicCoins, type TrackEvent } from "./mimic.server";

type DB = SupabaseClient<Database>;
// invo_bridge_* tables are not in the generated types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const raw = (db: DB) => db as unknown as SupabaseClient<any, any, any>;

export const BRIDGE = {
  /** Seconds between rounds over all followed portfolios. */
  cycleSeconds: 180,
  /** How long the bridge keeps listening after opening a portfolio page. */
  settleMs: 6000,
  maxBodyBytes: 600_000,
  /** Hosts whose JSON responses the bridge forwards (the Invo app's API). Changing this needs no bridge update. */
  captureHosts: ["api.invoapp.com"],
  homeUrl: "https://app.invoapp.com/",
  /** Warn when no bridge round has arrived for this long while portfolios are followed. */
  silentAfterMin: 20,
};
export const PSEUDO = "invo:";
const portfolioUrl = (pid: string) => `https://app.invoapp.com/portfolio/${pid.replace(/-/g, "")}`;
/** display_name is "<username> · <note>". */
const usernameOf = (display: string | null) => (display ?? "").split(" ")[0] ?? "";

/** The bridge authenticates with its own secret; APEX stores only its SHA-256 (app_private 'invo_bridge_secret_sha256'). */
export async function verifyBridge(request: Request) {
  const token = request.headers.get("x-bridge-secret");
  if (!token || token.length < 32 || token.length > 256) return null;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await raw(supabaseAdmin as DB).from("app_private").select("value").eq("name", "invo_bridge_secret_sha256").maybeSingle();
  return data?.value && data.value === hash ? (supabaseAdmin as DB) : null;
}

/** Pages the bridge opens about once a day for the weekly re-scout; their raw responses are kept in invo_bridge_raw. */
export const SCOUT_PAGES = [{ id: "scout:leaderboard", username: "", url: "https://app.invoapp.com/leaderboard" }];

export async function bridgeTargets(db: DB) {
  const { data } = await db.from("sm_wallets").select("address,display_name").contains("sources", ["invo_bridge"]);
  const targets = (data ?? []).filter((w) => w.address.startsWith(PSEUDO)).map((w) => {
    const id = w.address.slice(PSEUDO.length);
    return { id, username: usernameOf(w.display_name), url: portfolioUrl(id) };
  });
  const { data: seen } = await raw(db).from("invo_bridge_raw").select("portfolio_id,at").in("portfolio_id", SCOUT_PAGES.map((s) => s.id));
  for (const s of SCOUT_PAGES) {
    const at = (seen ?? []).find((r: { portfolio_id: string }) => r.portfolio_id === s.id)?.at;
    if (!at || Date.now() - Date.parse(at) > 20 * 3600_000) targets.push(s);
  }
  return {
    targets, capture_hosts: BRIDGE.captureHosts, cycle_seconds: BRIDGE.cycleSeconds, settle_ms: BRIDGE.settleMs,
    max_body_bytes: BRIDGE.maxBodyBytes, home_url: BRIDGE.homeUrl,
  };
}

export type BridgePayload = {
  version?: string; at?: string; logged_out?: boolean; host?: string;
  results: { id: string; url?: string; final_url?: string; error?: string | null; captures: Capture[] }[];
};

async function warnOnce(db: DB, message: string, metadata?: unknown, everyMs = 3600_000) {
  // At most one identical warning per period (default an hour), so a long outage does not flood the log.
  const since = new Date(Date.now() - everyMs).toISOString();
  const { data } = await db.from("agent_logs").select("id").eq("agent_name", "INVO BRIDGE").eq("message", message).gte("created_at", since).limit(1);
  if (data?.length) return;
  await db.from("agent_logs").insert({ agent_name: "INVO BRIDGE", message, level: "WARNING", market_id: "swing", metadata: (metadata ?? null) as never });
}
const info = (db: DB, message: string, metadata?: unknown) =>
  db.from("agent_logs").insert({ agent_name: "INVO BRIDGE", message, level: "INFO", market_id: "swing", metadata: (metadata ?? null) as never });

export async function ingestInvoBridge(db: DB, p: BridgePayload) {
  const { targets } = await bridgeTargets(db);
  const tmap = new Map(targets.map((t) => [t.id, t]));
  const { data: snap } = await db.from("hl_universe").select("snapshot_at").order("snapshot_at", { ascending: false }).limit(1);
  const { data: uni } = snap?.[0] ? await db.from("hl_universe").select("coin").eq("snapshot_at", snap[0].snapshot_at) : { data: [] };
  const universe = new Set((uni ?? []).map((r) => r.coin));
  const coinMap = (c: string) => normalizeCoin(c, universe);
  const events: TrackEvent[] = [];
  const problems: { user: string; problem: string }[] = [];
  let parsed = 0, positions = 0;
  const nowIso = new Date().toISOString();

  for (const r of p.results ?? []) {
    if (SCOUT_PAGES.some((s) => s.id === r.id)) {
      // Re-scout material: stored as captured, read by the weekly "APEX Invo re-scout" task.
      if (!r.error && r.captures?.length) await raw(db).from("invo_bridge_raw").upsert({ portfolio_id: r.id, at: nowIso, final_url: r.final_url ?? null,
        payload: r.captures.slice(0, 60) as never, note: "scout" });
      continue;
    }
    const t = tmap.get(r.id);
    if (!t) continue;
    if (r.error) { problems.push({ user: t.username, problem: r.error.slice(0, 200) }); continue; }
    const v = parseVisit({ portfolio_id: t.id, username: t.username }, Array.isArray(r.captures) ? r.captures : []);
    if (!v.ok) {
      problems.push({ user: t.username, problem: `no positions or open count understood in ${r.captures?.length ?? 0} responses` });
      // Keep the last unreadable visit so the parser can be fixed against real data.
      await raw(db).from("invo_bridge_raw").upsert({ portfolio_id: t.id, at: nowIso, final_url: r.final_url ?? null,
        payload: (r.captures ?? []).slice(0, 40) as never, note: "unparsed" });
      continue;
    }
    parsed++; positions += v.open.length;
    const addr = PSEUDO + t.id;
    const [{ data: prev }, { data: sc }] = await Promise.all([
      db.from("sm_positions").select("coin,side,entry_px,opened_at").eq("address", addr),
      db.from("sm_scores").select("tracked_at").eq("address", addr).maybeSingle(),
    ]);
    const baseline = !sc?.tracked_at;
    const d = diffInvo((prev ?? []).map((x) => ({ coin: x.coin, side: x.side as "long" | "short", entry_px: x.entry_px == null ? null : +x.entry_px, opened_at: x.opened_at })), v, coinMap, baseline);
    for (const u of d.upserts) {
      await db.from("sm_positions").upsert({ address: addr, coin: u.coin, side: u.side, szi: u.side === "long" ? 1 : -1, entry_px: u.entry_px,
        notional: null, leverage: u.leverage, account_value: null, opened_at: u.opened_at, updated_at: nowIso });
    }
    if (d.deletes.length) await db.from("sm_positions").delete().eq("address", addr).in("coin", d.deletes);
    for (const e of d.events) {
      await db.from("sm_events").insert({ address: addr, coin: e.coin, side: e.side, kind: e.kind, size: null, entry_px: e.entry_px, leverage: e.leverage, notional_frac: e.size_frac });
      events.push({ address: addr, coin: e.coin, side: e.side, kind: e.kind, entry_px: e.entry_px, leverage: e.leverage });
    }
    if (baseline) await db.from("sm_scores").update({ tracked_at: nowIso }).eq("address", addr);
    if (d.events.length) await info(db, `${t.username}: ${d.events.map((e) => `${e.kind} ${e.coin} ${e.side}`).join(", ")}`);
  }

  let mimic: unknown = null;
  if (events.length) {
    const { data: mir } = await db.from("sm_scores").select("address").eq("mirror", true);
    const [mids, tradable] = await Promise.all([hlInfo<Record<string, string>>({ type: "allMids" }), mimicCoins(db as never)]);
    mimic = await mimicStep(db as never, events, new Set((mir ?? []).map((r) => r.address)), mids, tradable);
  }
  await raw(db).from("invo_bridge_runs").insert({ version: p.version ?? null, host: p.host ?? null, visited: p.results?.length ?? 0, parsed,
    positions, events: events.length, logged_out: !!p.logged_out, problems: problems as never });
  if (Math.random() < 0.02) await raw(db).rpc("invo_bridge_prune");
  if (p.logged_out) await warnOnce(db, "Invo bridge is logged out of Invo: run login.cmd in Documents\\APEX Invo Bridge and sign in again.");
  else if (problems.length && parsed === 0) await warnOnce(db, "Invo bridge could not read any followed portfolio (Invo may have changed). Raw responses saved in invo_bridge_raw.", problems);
  else for (const pr of problems) await warnOnce(db, `Invo bridge could not read ${pr.user}: ${pr.problem}`);
  return { visited: p.results?.length ?? 0, parsed, positions, events: events.map((e) => `${e.kind} ${e.coin} ${e.side}`), problems, mimic };
}

/** Called from the tracker: warns when portfolios are followed but no bridge round has arrived recently. */
export async function checkBridgeHealth(db: DB) {
  const { count } = await db.from("sm_wallets").select("address", { count: "exact", head: true }).contains("sources", ["invo_bridge"]);
  if (!count) return null;
  const { data } = await raw(db).from("invo_bridge_runs").select("at").order("at", { ascending: false }).limit(1);
  const last = data?.[0]?.at ? Date.parse(data[0].at) : 0;
  const mins = (Date.now() - last) / 60_000;
  if (mins > BRIDGE.silentAfterMin) {
    // Never set up: remind once a day. Set up but silent: hourly, because follows are paused.
    if (last) await warnOnce(db, `Invo bridge silent for over ${BRIDGE.silentAfterMin} min (computer off, asleep or offline?). Invo follows pause; on-chain follows continue.`, { silent_min: Math.round(mins) });
    else await warnOnce(db, "Invo bridge has not reported yet: run setup in Documents\\APEX Invo Bridge.", null, 24 * 3600_000);
    return { silent_min: Math.round(mins) };
  }
  return { last_min: Math.round(mins) };
}
