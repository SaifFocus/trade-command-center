import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { runCopyBacktestFn, syncCopyDataFn } from "@/lib/sm/scout.functions";

export const Route = createFileRoute("/_authenticated/scout")({
  head: () => ({ meta: [{ title: "APEX — Scout" }, { name: "description", content: "Graded traders, live events and the copy backtest." }] }),
  component: ScoutPage,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Wallet = {
  address: string; tier: string | null; score: number; eligible: boolean; fast: boolean; watchlist: boolean; practice: boolean;
  sources: string[]; display_name: string | null; originator: number | null;
  win_rate: number | null; profit_factor: number | null; ret_90: number | null; mdd_90: number | null; median_hold_h: number | null;
  avg_lev: number | null; trades: number | null; last_trade_at: string | null;
};

const fmt = (n: unknown, d = 2) => (n == null || !isFinite(Number(n)) ? "—" : Number(n).toFixed(d));
const pct = (n: unknown, d = 1) => (n == null || !isFinite(Number(n)) ? "—" : `${Number(n).toFixed(d)}%`);
const time = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }).slice(0, 16) : "—");
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

function Panel({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="panel rounded-lg p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs tracking-[0.3em] text-neon">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function SourceBadge({ sources }: { sources: string[] }) {
  return (
    <span className="space-x-1">
      {sources.includes("invo") && <span className="rounded border border-border px-1 text-[10px] text-neon">INVO</span>}
      {sources.includes("leaderboard") && <span className="rounded border border-border px-1 text-[10px] text-muted-foreground">LB</span>}
    </span>
  );
}

function ScoutPage() {
  const runCopy = useServerFn(runCopyBacktestFn);
  const syncCopy = useServerFn(syncCopyDataFn);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [jobs, setJobs] = useState<Row[]>([]);
  const [events, setEvents] = useState<Row[]>([]);
  const [mimic, setMimic] = useState<Row[]>([]);
  const [copyRun, setCopyRun] = useState<Row | null>(null);
  const [counts, setCounts] = useState<{ candidates: number; invo: number; lb: number }>({ candidates: 0, invo: 0, lb: 0 });
  const [tier, setTier] = useState<"all" | "A" | "B" | "AB" | "P">("AB");
  const [source, setSource] = useState<"all" | "invo" | "leaderboard">("all");
  const [swingOnly, setSwingOnly] = useState(true);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ curve: { t: string; v: number }[]; trades: Row[] } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = async () => {
    const [sc, jb, ev, runs, cand, invo, lb] = await Promise.all([
      supabase.from("sm_scores").select("address,tier,score,eligible,fast,watchlist,practice").order("score", { ascending: false }).limit(2000),
      supabase.from("sm_jobs").select("*"),
      supabase.from("sm_events").select("*").order("t", { ascending: false }).limit(30),
      supabase.from("backtest_runs").select("*").eq("params->>kind", "copy").order("created_at", { ascending: false }).limit(1),
      supabase.from("sm_wallets").select("address", { count: "exact", head: true }),
      supabase.from("sm_wallets").select("address", { count: "exact", head: true }).contains("sources", ["invo"]),
      supabase.from("sm_wallets").select("address", { count: "exact", head: true }).contains("sources", ["leaderboard"]),
    ]);
    const scores = (sc.data ?? []) as Row[];
    const addrs = scores.map((s) => s.address);
    const stats = new Map<string, Row>(), meta = new Map<string, Row>();
    for (let i = 0; i < addrs.length; i += 300) {
      const chunk = addrs.slice(i, i + 300);
      const [st, ws] = await Promise.all([
        supabase.from("sm_wallet_stats").select("address,win_rate,profit_factor,ret_90,mdd_90,median_hold_h,avg_lev,trades,last_trade_at").in("address", chunk),
        supabase.from("sm_wallets").select("address,sources,display_name,invo_originator_share").in("address", chunk),
      ]);
      for (const r of (st.data ?? []) as Row[]) stats.set(r.address, r);
      for (const r of (ws.data ?? []) as Row[]) meta.set(r.address, r);
    }
    setWallets(scores.map((s) => {
      const st = stats.get(s.address) ?? {}, m = meta.get(s.address) ?? {};
      return {
        address: s.address, tier: s.tier, score: +s.score, eligible: s.eligible, fast: s.fast, watchlist: s.watchlist, practice: !!s.practice,
        sources: m.sources ?? [], display_name: m.display_name ?? null, originator: m.invo_originator_share == null ? null : +m.invo_originator_share,
        win_rate: st.win_rate ?? null, profit_factor: st.profit_factor ?? null, ret_90: st.ret_90 ?? null, mdd_90: st.mdd_90 ?? null,
        median_hold_h: st.median_hold_h ?? null, avg_lev: st.avg_lev ?? null, trades: st.trades ?? null, last_trade_at: st.last_trade_at ?? null,
      };
    }));
    setJobs((jb.data ?? []) as Row[]);
    setEvents((ev.data ?? []) as Row[]);
    // mimic_trades is not in the generated types
    const { data: mt } = await (supabase as unknown as { from: (t: string) => any }).from("mimic_trades").select("*").order("opened_at", { ascending: false }).limit(500);
    setMimic((mt ?? []) as Row[]);
    setCopyRun(((runs.data ?? []) as Row[])[0] ?? null);
    setCounts({ candidates: cand.count ?? 0, invo: invo.count ?? 0, lb: lb.count ?? 0 });
  };
  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, []);

  useEffect(() => {
    if (!open) { setDetail(null); return; }
    (async () => {
      const [st, tr] = await Promise.all([
        supabase.from("sm_wallet_stats").select("portfolio").eq("address", open).maybeSingle(),
        supabase.from("sm_trades").select("coin,side,entry_t,exit_t,entry_px,exit_px,net_pnl,hold_h,max_notional").eq("address", open).order("exit_t", { ascending: false }).limit(25),
      ]);
      const av = ((st.data?.portfolio as { av?: [number, number][] } | null)?.av ?? []).map(([t, v]) => ({ t: time(new Date(t).toISOString()), v: +v }));
      setDetail({ curve: av, trades: (tr.data ?? []) as Row[] });
    })();
  }, [open]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true); setStatus(`${label}...`);
    try { const r = await fn(); setStatus(`${label} DONE · ${JSON.stringify(r).slice(0, 400)}`); await load(); }
    catch (e) { setStatus(`ERROR: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(false);
  };

  const shown = useMemo(() => wallets.filter((w) => {
    if (tier === "A" && w.tier !== "A") return false;
    if (tier === "B" && w.tier !== "B") return false;
    if (tier === "AB" && w.tier !== "A" && w.tier !== "B") return false;
    if (tier === "P" && !w.practice) return false;
    if (source !== "all" && !w.sources.includes(source)) return false;
    if (swingOnly && (w.fast || (w.median_hold_h ?? 0) < 24)) return false;
    return true;
  }), [wallets, tier, source, swingOnly]);

  const job = (name: string) => (jobs.find((j) => j.name === name)?.state ?? {}) as Row;
  const dd = job("deep_dive"), inv = job("invo"), lbj = job("leaderboard"), cs = job("copy_sync");
  const tierCount = (t: string) => wallets.filter((w) => w.tier === t).length;
  const variants = (copyRun?.summary?.variants ?? {}) as Record<string, Row>;

  const sel = "rounded border border-border bg-terminal px-2 py-1 text-xs";
  return (
    <div className="min-h-screen">
      <header className="panel border-b">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
          <h1 className="text-neon font-display text-2xl font-black tracking-[0.2em]">APEX · SCOUT</h1>
          <div className="flex gap-4">
            <Link to="/desk" className="text-xs tracking-widest text-muted-foreground hover:text-neon">DESK</Link>
            <Link to="/" className="text-xs tracking-widest text-muted-foreground hover:text-neon">← DASHBOARD</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] space-y-4 px-6 py-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="PIPELINE">
            <table className="w-full text-xs"><tbody>
              <tr className="border-t border-border/50"><td className="py-1 text-muted-foreground">Candidates</td><td className="tabular-nums">{counts.candidates} · {counts.lb} leaderboard · {counts.invo} Invo</td></tr>
              <tr className="border-t border-border/50"><td className="py-1 text-muted-foreground">Graded</td><td className="tabular-nums">{wallets.length} · tier A {tierCount("A")} · tier B {tierCount("B")} · watchlist {wallets.filter((w) => w.watchlist && !w.practice).length} · practice {wallets.filter((w) => w.practice).length} (paper only)</td></tr>
              <tr className="border-t border-border/50"><td className="py-1 text-muted-foreground">Grading queue</td><td className="tabular-nums">{dd.queue ?? "—"} left · {dd.per_min ?? "—"}/min · last {time(dd.last_run)}</td></tr>
              <tr className="border-t border-border/50"><td className="py-1 text-muted-foreground">Leaderboard pull</td><td>{time(lbj.at)} · {lbj.passing_floor ?? "—"} pass floor</td></tr>
              <tr className="border-t border-border/50"><td className="py-1 text-muted-foreground">Invo files</td><td>{inv.remaining_days != null ? `${inv.remaining_days} days left` : "—"} · {inv.candidates ?? "—"} wallets</td></tr>
              <tr className="border-t border-border/50"><td className="py-1 text-muted-foreground">Copy data</td><td>{cs.coins ?? "—"} coins · {cs.stale ?? "—"} stale · {time(cs.last_run)}</td></tr>
            </tbody></table>
          </Panel>

          <Panel title="COPY BACKTEST (WALK-FORWARD)" right={
            <div className="flex gap-2">
              <button disabled={busy} onClick={() => act("SYNC PRICES", () => syncCopy())} className="rounded border border-border px-2 py-1 text-[11px] tracking-widest text-muted-foreground hover:text-neon disabled:opacity-40">SYNC</button>
              <button disabled={busy} onClick={() => act("RUN BACKTEST", () => runCopy())} className="rounded border border-border px-2 py-1 text-[11px] tracking-widest text-neon hover:opacity-80 disabled:opacity-40">RUN</button>
            </div>}>
            {!copyRun ? <div className="text-xs text-muted-foreground">No run yet. It needs graded wallets with at least 90 days of history, then runs daily.</div> : (
              <div className="space-y-2 text-xs">
                <div className="text-muted-foreground">{time(copyRun.created_at)} · {copyRun.status}{copyRun.error ? ` · ${copyRun.error}` : ""} · {copyRun.summary?.months?.length ?? 0} months · {copyRun.summary?.wallets ?? 0} wallets · {copyRun.summary?.signals ?? 0} signals</div>
                <table className="w-full">
                  <thead className="text-muted-foreground"><tr className="text-left"><th>VARIANT</th><th>TRADES</th><th>WIN</th><th>EXP R</th><th>PF</th><th>MAX DD</th><th>RETURN</th><th>GATE</th></tr></thead>
                  <tbody>{(["tier_a", "consensus"] as const).map((v) => {
                    const s = variants[v];
                    return (
                      <tr key={v} className="border-t border-border/50">
                        <td>{v === "tier_a" ? "Tier A opens" : "Consensus ≥2"}</td>
                        <td className="tabular-nums">{s?.all?.trades ?? "—"}</td><td className="tabular-nums">{s ? pct(s.all.win_rate * 100) : "—"}</td>
                        <td className="tabular-nums">{fmt(s?.all?.expectancy_r, 3)}</td><td className="tabular-nums">{fmt(s?.all?.profit_factor)}</td>
                        <td className="tabular-nums">{pct(s?.all?.max_drawdown_pct)}</td><td className="tabular-nums">{pct(s?.all?.final_return_pct)}</td>
                        <td className={s?.gate?.pass ? "text-neon" : "text-destructive"}>{s ? (s.gate.pass ? "PASS" : "FAIL") : "—"}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
                <div className="text-muted-foreground">Gate: ≥60 trades, positive expectancy in both the first 60% and last 40% of months, max drawdown under 20%. Follow signals stay paper-only until a variant passes.</div>
              </div>
            )}
          </Panel>

          <Panel title="LIVE EVENTS (WATCHLIST)">
            {events.length === 0 ? <div className="text-xs text-muted-foreground">No events yet. The watchlist fills once wallets are graded.</div> : (
              <div className="max-h-56 overflow-y-auto"><table className="w-full text-xs"><tbody>{events.map((e) => (
                <tr key={e.id} className="border-t border-border/50"><td>{time(e.t)}</td><td className="font-mono">{short(e.address)}</td><td>{String(e.kind).toUpperCase()}</td><td>{e.coin}</td><td>{String(e.side).toUpperCase()}</td><td className="tabular-nums">{e.entry_px ?? ""}</td></tr>
              ))}</tbody></table></div>
            )}
          </Panel>
        </div>

        <MimicPanel rows={mimic} />

        <Panel title={`GRADED TRADERS (${shown.length})`} right={
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select className={sel} value={tier} onChange={(e) => setTier(e.target.value as typeof tier)}>
              <option value="AB">Tier A + B</option><option value="A">Tier A</option><option value="B">Tier B</option><option value="P">Practice follows</option><option value="all">All graded</option>
            </select>
            <select className={sel} value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
              <option value="all">All sources</option><option value="invo">Invo</option><option value="leaderboard">Leaderboard</option>
            </select>
            <label className="flex items-center gap-1 text-muted-foreground"><input type="checkbox" checked={swingOnly} onChange={(e) => setSwingOnly(e.target.checked)} /> swing only</label>
          </div>}>
          {shown.length === 0 ? <div className="text-xs text-muted-foreground">Nothing matches yet. Grading runs every 5 minutes; try "All graded".</div> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr className="text-left"><th></th><th>WALLET</th><th>SRC</th><th>TIER</th><th>SCORE</th><th>WIN</th><th>PF</th><th>90D RET</th><th>90D DD</th><th>MED HOLD</th><th>LEV</th><th>TRADES</th><th>LAST</th><th>ORIG</th></tr></thead>
              <tbody>{shown.slice(0, 300).map((w) => (
                <tr key={w.address} onClick={() => setOpen(open === w.address ? null : w.address)} className={`cursor-pointer border-t border-border/50 hover:bg-terminal ${open === w.address ? "bg-terminal" : ""}`}>
                  <td title={w.practice ? "Practice follow: below the full bar, paper only" : undefined}>{w.practice ? "☆" : w.watchlist ? "★" : ""}</td>
                  <td className="font-mono">
                    {short(w.address)}{w.display_name ? <span className="text-muted-foreground"> {w.display_name}</span> : null}{" "}
                    <button onClick={async (e) => { e.stopPropagation(); try { await navigator.clipboard.writeText(w.address); setCopied(w.address); } catch { /* clipboard blocked */ } }} className="text-[10px] text-muted-foreground hover:text-neon">{copied === w.address ? "copied" : "copy"}</button>
                  </td>
                  <td><SourceBadge sources={w.sources} /></td>
                  <td className={w.tier === "A" ? "text-neon" : ""}>{w.tier ?? (w.fast ? "fast" : "—")}</td>
                  <td className="tabular-nums">{fmt(w.score)}</td><td className="tabular-nums">{pct(w.win_rate)}</td><td className="tabular-nums">{fmt(w.profit_factor)}</td>
                  <td className="tabular-nums">{pct(w.ret_90)}</td><td className="tabular-nums">{pct(w.mdd_90)}</td><td className="tabular-nums">{w.median_hold_h == null ? "—" : `${fmt(w.median_hold_h, 0)}h`}</td>
                  <td className="tabular-nums">{fmt(w.avg_lev, 1)}x</td><td className="tabular-nums">{w.trades ?? "—"}</td><td>{time(w.last_trade_at)}</td>
                  <td className="tabular-nums">{w.originator == null ? "—" : pct(w.originator * 100, 0)}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </Panel>

        {open && (
          <Panel title={`WALLET ${short(open)}`} right={<button onClick={() => setOpen(null)} className="text-xs text-muted-foreground hover:text-neon">CLOSE</button>}>
            {!detail ? <div className="text-xs text-muted-foreground">Loading...</div> : (
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="h-56">
                  {detail.curve.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={detail.curve}>
                        <XAxis dataKey="t" hide /><YAxis domain={["auto", "auto"]} width={60} tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 11 }} />
                        <Line type="monotone" dataKey="v" stroke="var(--neon)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <div className="text-xs text-muted-foreground">No account history stored.</div>}
                  <div className="mt-1 text-[11px] text-muted-foreground">Account value (USD), from Hyperliquid's portfolio history</div>
                </div>
                <div className="max-h-64 overflow-y-auto"><table className="w-full text-xs">
                  <thead className="text-muted-foreground"><tr className="text-left"><th>CLOSED</th><th>COIN</th><th>SIDE</th><th>ENTRY</th><th>EXIT</th><th>HOLD</th><th>NET $</th></tr></thead>
                  <tbody>{detail.trades.map((t, i) => (
                    <tr key={i} className="border-t border-border/50"><td>{time(t.exit_t)}</td><td>{t.coin}</td><td>{String(t.side).toUpperCase()}</td>
                      <td className="tabular-nums">{Number(t.entry_px).toPrecision(5)}</td><td className="tabular-nums">{Number(t.exit_px).toPrecision(5)}</td>
                      <td className="tabular-nums">{fmt(t.hold_h, 0)}h</td><td className={`tabular-nums ${+t.net_pnl >= 0 ? "text-neon" : "text-destructive"}`}>{fmt(t.net_pnl)}</td></tr>
                  ))}</tbody>
                </table></div>
              </div>
            )}
          </Panel>
        )}
        <div className="break-all font-mono text-[11px] text-muted-foreground">{status}</div>
      </main>
    </div>
  );
}

function MimicPanel({ rows }: { rows: Row[] }) {
  const closed = rows.filter((r) => r.status === "closed");
  const open = rows.filter((r) => r.status === "open");
  const wins = closed.filter((r) => +r.net_usd > 0).length;
  const net = closed.reduce((a, r) => a + +r.net_usd, 0);
  const avg = closed.length ? closed.reduce((a, r) => a + +r.net_pct, 0) / closed.length : 0;
  return (
    <Panel title="MIMIC SIMULATOR (PAPER) · $100 COPIES OF ACTIVE INVO TRADERS, A FEW MINUTES LATE, AFTER INVO FEES">
      <div className="mb-2 text-xs">
        Closed <span className="tabular-nums">{closed.length}</span> · win rate <span className="tabular-nums">{closed.length ? ((wins / closed.length) * 100).toFixed(1) : "—"}%</span> ·
        avg <span className={`tabular-nums ${avg >= 0 ? "text-neon" : "text-destructive"}`}>{avg.toFixed(2)}%</span> per trade ·
        total <span className={`tabular-nums ${net >= 0 ? "text-neon" : "text-destructive"}`}>${net.toFixed(2)}</span> · open <span className="tabular-nums">{open.length}</span>
      </div>
      {rows.length === 0 ? <div className="text-xs text-muted-foreground">No copies yet. Traders are picked once graded Invo wallets qualify (active in the last 3 days, 20+ trades, profit factor 1.2+, profitable).</div> : (
        <div className="max-h-64 overflow-y-auto"><table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr className="text-left"><th>OPENED</th><th>TRADER</th><th>COIN</th><th>SIDE</th><th>ENTRY</th><th>THEIR ENTRY</th><th>EXIT</th><th>NET %</th><th>STATUS</th></tr></thead>
          <tbody>{rows.slice(0, 60).map((r) => (
            <tr key={r.id} className="border-t border-border/50">
              <td>{new Date(r.opened_at).toLocaleString("sv-SE", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
              <td className="font-mono">{String(r.address).slice(0, 6)}…{String(r.address).slice(-4)}</td><td>{r.coin}</td><td>{String(r.side).toUpperCase()}</td>
              <td className="tabular-nums">{(+r.entry_px).toPrecision(6)}</td><td className="tabular-nums">{r.their_entry_px ? (+r.their_entry_px).toPrecision(6) : "—"}</td>
              <td className="tabular-nums">{r.exit_px ? (+r.exit_px).toPrecision(6) : "—"}</td>
              <td className={`tabular-nums ${+(r.net_pct ?? 0) >= 0 ? "text-neon" : "text-destructive"}`}>{r.net_pct == null ? "—" : (+r.net_pct).toFixed(2)}</td>
              <td>{r.status === "open" ? "OPEN" : r.exit_reason}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </Panel>
  );
}
