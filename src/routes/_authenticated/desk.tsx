import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { runCycleFn, runExecuteFn, setKillSwitchFn } from "@/lib/hl/desk.functions";
import { LivePanel } from "@/components/desk/LivePanel";
import { InvoTickets } from "@/components/desk/InvoTickets";
import type { Database } from "@/integrations/supabase/types";

export const Route = createFileRoute("/_authenticated/desk")({
  head: () => ({ meta: [{ title: "APEX — Desk" }, { name: "description", content: "Private trading desk." }] }),
  component: DeskPage,
});

type T = Database["public"]["Tables"];
type Cfg = T["desk_config"]["Row"];
type Sig = T["signals"]["Row"];
type Pos = T["paper_positions"]["Row"];
type Eq = T["paper_equity"]["Row"];

const fmt = (n: number | null | undefined, d = 2) => (n == null || !isFinite(+n) ? "—" : (+n).toFixed(d));
const time = (s: string | null) => (s ? new Date(s).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }).slice(0, 16) : "—");

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel rounded-lg p-4">
      <h2 className="mb-3 text-xs tracking-[0.3em] text-neon">{title}</h2>
      {children}
    </section>
  );
}

function DeskPage() {
  const cycle = useServerFn(runCycleFn);
  const execute = useServerFn(runExecuteFn);
  const setKill = useServerFn(setKillSwitchFn);
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [sigs, setSigs] = useState<Sig[]>([]);
  const [pos, setPos] = useState<Pos[]>([]);
  const [eq, setEq] = useState<Eq[]>([]);
  const [mids, setMids] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("IDLE");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [c, s, p, e] = await Promise.all([
      supabase.from("desk_config").select("*").eq("id", 1).maybeSingle(),
      supabase.from("signals").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("paper_positions").select("*").order("entry_t", { ascending: false }).limit(500),
      supabase.from("paper_equity").select("*").order("t", { ascending: true }).limit(1000),
    ]);
    setCfg(c.data ?? null); setSigs(s.data ?? []); setPos(p.data ?? []); setEq(e.data ?? []);
  };
  const loadMids = async () => {
    try {
      const r = await fetch("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "allMids" }) });
      if (r.ok) setMids(await r.json());
    } catch { /* live prices are optional */ }
  };
  useEffect(() => { load(); loadMids(); const id = setInterval(() => { load(); loadMids(); }, 30_000); return () => clearInterval(id); }, []);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true); setStatus(`${label}...`);
    try { const r = await fn(); setStatus(`${label} DONE · ${JSON.stringify(r)}`); await load(); }
    catch (e) { setStatus(`ERROR: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(false);
  };

  const usdSek = cfg?.usd_sek ? +cfg.usd_sek : null;
  const real = pos.filter((p) => !p.shadow);
  const openReal = real.filter((p) => p.status === "open");
  const openShadow = pos.filter((p) => p.shadow && p.status === "open");
  const closed = pos.filter((p) => p.status === "closed");
  const realizedAll = real.filter((p) => p.status === "closed").reduce((a, p) => a + +(p.net_usd ?? 0), 0);
  const sumSince = (ms: number) => real.filter((p) => p.status === "closed" && p.exit_t && Date.parse(p.exit_t) >= Date.now() - ms).reduce((a, p) => a + +(p.net_usd ?? 0), 0);
  const equity = cfg && usdSek ? +cfg.budget_sek / usdSek + realizedAll : null;
  const peak = Math.max(equity ?? 0, ...eq.map((e) => +e.equity_usd));
  const dd = equity && peak ? ((peak - equity) / peak) * 100 : 0;
  const openRisk = openReal.reduce((a, p) => a + Math.max(0, (p.side === "long" ? 1 : -1) * (+p.entry_px - +p.stop_px)) * +p.size_coin * +p.remaining_frac, 0);

  const livePnl = (p: Pos) => {
    const m = Number(mids[p.coin]);
    if (!(m > 0)) return null;
    const dir = p.side === "long" ? 1 : -1;
    return +p.gross_usd + dir * (m - +p.entry_px) * +p.size_coin * +p.remaining_frac - +p.fees_usd - +p.funding_usd;
  };

  const cmp = (group: "real" | "risk" | "vetoed") => {
    const xs = closed.filter((p) => (group === "real" ? !p.shadow : p.shadow && (p.shadow_reason ?? "vetoed") === group));
    const n = xs.length;
    return { n, wr: n ? xs.filter((p) => +(p.net_r ?? 0) > 0).length / n : 0, avg: n ? xs.reduce((a, p) => a + +(p.net_r ?? 0), 0) / n : 0 };
  };

  const ruleRow = (label: string, val: string, limit: string, bad: boolean) => (
    <tr className="border-t border-border/50"><td className="py-1 text-muted-foreground">{label}</td><td className="tabular-nums">{val}</td><td className="text-muted-foreground">{limit}</td><td className={bad ? "text-destructive" : "text-neon"}>{bad ? "BREACH" : "OK"}</td></tr>
  );

  const PosTable = ({ rows, live }: { rows: Pos[]; live: boolean }) => rows.length === 0 ? <div className="text-xs text-muted-foreground">None.</div> : (
    <div className="overflow-x-auto"><table className="w-full text-xs">
      <thead className="text-muted-foreground"><tr className="text-left"><th>COIN</th><th>SIDE</th><th>SETUP</th><th>ENTRY</th><th>STOP</th><th>T1/T2</th><th>NOTIONAL</th><th>{live ? "LIVE P&L $" : "NET $"}</th><th>{live ? "BARS" : "NET R"}</th><th>{live ? "OPENED" : "EXIT"}</th></tr></thead>
      <tbody>{rows.map((p) => {
        const v = live ? livePnl(p) : +(p.net_usd ?? 0);
        return (
          <tr key={p.id} className="border-t border-border/50">
            <td title={p.shadow ? (p.shadow_reason === "risk" ? "Shadow: blocked by risk rules" : "Shadow: vetoed by review") : undefined}>{p.shadow ? (p.shadow_reason === "risk" ? "◌R " : "◌V ") : ""}{p.coin}</td><td>{p.side.toUpperCase()}</td><td>{p.setup}</td>
            <td className="tabular-nums">{(+p.entry_px).toPrecision(6)}</td><td className="tabular-nums">{(+p.stop_px).toPrecision(6)}{p.t1_hit ? " (BE)" : ""}</td>
            <td className="tabular-nums">{(+p.t1_px).toPrecision(5)} / {(+p.t2_px).toPrecision(5)}</td><td className="tabular-nums">${fmt(+p.notional_usd)}</td>
            <td className={`tabular-nums ${(v ?? 0) >= 0 ? "text-neon" : "text-destructive"}`}>{fmt(v)}</td>
            <td className="tabular-nums">{live ? p.bars_held : fmt(p.net_r)}</td>
            <td>{live ? time(p.entry_t) : `${time(p.exit_t)} · ${p.exit_reason}`}</td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );

  return (
    <div className="min-h-screen">
      <header className="panel border-b">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
          <h1 className="text-neon font-display text-2xl font-black tracking-[0.2em]">APEX · DESK</h1>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] space-y-4 px-6 py-6">
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={busy} onClick={() => act("CYCLE", () => cycle())} className="rounded border border-border bg-terminal px-3 py-1.5 text-xs tracking-widest text-neon hover:opacity-80 disabled:opacity-40">RUN CYCLE</button>
          <button disabled={busy} onClick={() => act("EXECUTE", () => execute())} className="rounded border border-border bg-terminal px-3 py-1.5 text-xs tracking-widest text-neon hover:opacity-80 disabled:opacity-40">RUN EXECUTE</button>
          <span className="break-all font-mono text-[11px] text-muted-foreground">{status}</span>
        </div>

        <LivePanel usdSek={usdSek} />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel title="CONFIG">
            {cfg ? (
              <div className="space-y-1 text-xs">
                <div>MODE <span className="text-neon">{cfg.mode.toUpperCase()}</span>{(cfg as { live_armed?: boolean }).live_armed ? " · LIVE ARMED" : " · NO REAL ORDERS"}</div>
                <div>BUDGET <span className="tabular-nums">{fmt(+cfg.budget_sek, 0)} SEK</span> = <span className="tabular-nums">${usdSek ? fmt(+cfg.budget_sek / usdSek) : "—"}</span> <span className="text-muted-foreground">(USD/SEK {fmt(usdSek, 4)})</span></div>
                <div>EQUITY <span className="tabular-nums text-neon">${fmt(equity)}</span> = <span className="tabular-nums">{equity && usdSek ? fmt(equity * usdSek) : "—"} SEK</span></div>
                <div className="text-muted-foreground">RISK {cfg.risk_pct}% (max {cfg.max_risk_pct}%) · MAX OPEN {cfg.max_open} · MIN ORDER ${cfg.min_order_usd} · FEE {cfg.fee_pct}% · SLIP {cfg.slip_pct}%</div>
                <div className="text-muted-foreground">NIGHT RULE {cfg.night_rule ? "ON" : "OFF"} · REVIEW WINDOW {cfg.review_window_minutes} MIN</div>
                <div className="text-muted-foreground">SETUPS {cfg.enabled_setups.join(", ")}</div>
                <div className="text-muted-foreground">COINS top 20 by volume{cfg.paper_extra_coins?.length ? ` + ${cfg.paper_extra_coins.length} checked extras (${cfg.paper_extra_coins.join(", ")})` : " (extra coins: universe check pending or not passed)"}</div>
                <button disabled={busy} onClick={() => act(cfg.kill_switch ? "KILL SWITCH OFF" : "KILL SWITCH ON", () => setKill({ data: { on: !cfg.kill_switch } }))}
                  className={`mt-2 rounded border px-3 py-1.5 text-xs tracking-widest disabled:opacity-40 ${cfg.kill_switch ? "border-destructive text-destructive" : "border-border text-muted-foreground hover:text-neon"}`}>
                  KILL SWITCH: {cfg.kill_switch ? "ON — ENTRIES BLOCKED" : "OFF"}
                </button>
              </div>
            ) : <div className="text-xs text-muted-foreground">Loading...</div>}
          </Panel>

          <Panel title="RULE STATUS">
            {cfg && equity ? (
              <table className="w-full text-xs"><tbody>
                {ruleRow("Daily loss (24h)", `$${fmt(sumSince(86400_000))}`, `${cfg.daily_loss_pct}%`, -sumSince(86400_000) >= equity * +cfg.daily_loss_pct / 100)}
                {ruleRow("Weekly loss (7d)", `$${fmt(sumSince(7 * 86400_000))}`, `${cfg.weekly_loss_pct}%`, -sumSince(7 * 86400_000) >= equity * +cfg.weekly_loss_pct / 100)}
                {ruleRow("Drawdown from peak", `${fmt(dd)}%`, `${cfg.kill_drawdown_pct}%`, dd >= +cfg.kill_drawdown_pct)}
                {ruleRow("Open positions", `${openReal.length}`, `${cfg.max_open}`, openReal.length >= cfg.max_open)}
                {ruleRow("Open risk", `$${fmt(openRisk)}`, "—", false)}
              </tbody></table>
            ) : <div className="text-xs text-muted-foreground">Waiting for USD/SEK rate.</div>}
          </Panel>

          <Panel title="EQUITY CURVE (USD)">
            <div className="h-40">
              {eq.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={eq.map((e) => ({ t: time(e.t), v: +e.equity_usd }))}>
                    <XAxis dataKey="t" hide /><YAxis domain={["auto", "auto"]} width={40} tick={{ fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", fontSize: 11 }} />
                    <Line type="monotone" dataKey="v" stroke="var(--neon)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <div className="text-xs text-muted-foreground">Not enough snapshots yet.</div>}
            </div>
          </Panel>
        </div>

        <Panel title="SIGNALS & CLAUDE REVIEW">
          {sigs.length === 0 ? <div className="text-xs text-muted-foreground">No signals yet.</div> : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead className="text-muted-foreground"><tr className="text-left"><th>TIME</th><th>COIN</th><th>SIDE</th><th>SETUP</th><th>REF</th><th>STOP</th><th>REGIME</th><th>STATUS</th><th>REVIEW</th><th>CONF</th><th>NOTES / RISK</th></tr></thead>
              <tbody>{sigs.map((s) => {
                const rv = (s.review ?? null) as { decision?: string; confidence?: number; crowding_flag?: boolean; notes?: unknown } | null;
                return (
                  <tr key={s.id} className="border-t border-border/50 align-top">
                    <td>{time(s.created_at)}</td><td>{s.coin}</td><td>{s.side.toUpperCase()}</td><td>{s.setup}</td>
                    <td className="tabular-nums">{(+s.ref_px).toPrecision(6)}</td><td className="tabular-nums">{(+s.stop_px).toPrecision(6)}</td><td>{s.regime}</td>
                    <td className="text-neon">{s.status.toUpperCase()}</td>
                    <td>{rv?.decision ?? "—"}{rv?.crowding_flag ? " · CROWDED" : ""}</td><td>{rv?.confidence ?? "—"}</td>
                    <td className="max-w-[360px] break-words text-muted-foreground">{rv?.notes ? JSON.stringify(rv.notes) : ""}{s.risk_note ? ` RISK: ${s.risk_note}` : ""}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </Panel>

        <InvoTickets usdSek={usdSek} />

        <Panel title="OPEN POSITIONS (PAPER)"><PosTable rows={[...openReal, ...openShadow]} live /></Panel>
        <Panel title="CLOSED TRADES"><PosTable rows={closed} live={false} /></Panel>

        <Panel title="APPROVED vs SHADOW TRADES (◌V vetoed · ◌R blocked by risk rules)">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground"><tr className="text-left"><th>GROUP</th><th>TRADES</th><th>WIN RATE</th><th>AVG NET R</th></tr></thead>
            <tbody>{([["APPROVED (real)", cmp("real")], ["BLOCKED BY RISK (shadow)", cmp("risk")], ["VETOED (shadow)", cmp("vetoed")]] as const).map(([l, c]) => (
              <tr key={l} className="border-t border-border/50"><td>{l}</td><td className="tabular-nums">{c.n}</td><td className="tabular-nums">{fmt(c.wr * 100, 1)}%</td><td className="tabular-nums">{fmt(c.avg, 3)}</td></tr>
            ))}</tbody>
          </table>
        </Panel>
      </main>
    </div>
  );
}
