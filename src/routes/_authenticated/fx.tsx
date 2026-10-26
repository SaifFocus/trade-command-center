import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, ReferenceLine, Legend } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { resetBookFn } from "@/lib/fx/fx.functions";
import { unrealized } from "@/lib/fx/fx";
import { sameHourClusters, stats, type GridTrade } from "@/lib/desk/trade-grid";
import { Dots } from "@/components/desk/TradeDots";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/fx")({
  head: () => ({ meta: [{ title: "APEX — FX Desk" }, { name: "description", content: "Private FX and metals paper desk." },
    { property: "og:title", content: "APEX — FX Desk" },
    { property: "og:description", content: "Private FX and metals paper desk." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" }] }),
  component: FxPage,
});

type T = Database["public"]["Tables"];
type Book = T["fx_books"]["Row"];
type Pos = T["fx_positions"]["Row"];
type Quote = T["fx_quotes"]["Row"];
type Eq = T["fx_equity"]["Row"];

const COLORS: Record<string, string> = { sprint: "var(--neon)", steady: "var(--gold, #D9B84C)" };
const f = (n: number | null | undefined, d = 2) => (n == null || !isFinite(+n) ? "—" : (+n).toFixed(d));
const px = (n: number | null | undefined) => (n == null ? "—" : (+n).toPrecision(6));
const time = (s: string | null) => (s ? new Date(s).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }).slice(0, 16) : "—");
const short = (c: string) => c.replace("xyz:", "");

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel rounded-lg p-4">
      <h2 className="mb-3 text-xs tracking-[0.3em] text-neon">{title}</h2>
      {children}
    </section>
  );
}

function FxPage() {
  const reset = useServerFn(resetBookFn);
  const [books, setBooks] = useState<Book[]>([]);
  const [pos, setPos] = useState<Pos[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [eq, setEq] = useState<Eq[]>([]);
  const [usdSek, setUsdSek] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    const [b, p, q, e, c] = await Promise.all([
      supabase.from("fx_books").select("*").order("id", { ascending: true }),
      supabase.from("fx_positions").select("*").order("opened_at", { ascending: false }).limit(1000),
      supabase.from("fx_quotes").select("*"),
      supabase.from("fx_equity").select("*").order("t", { ascending: true }).limit(5000),
      supabase.from("desk_config").select("usd_sek").eq("id", 1).maybeSingle(),
    ]);
    const firstErr = b.error ?? p.error ?? q.error ?? e.error;
    setErr(firstErr ? firstErr.message : null);
    setBooks(b.data ?? []); setPos(p.data ?? []); setEq(e.data ?? []);
    setQuotes(Object.fromEntries((q.data ?? []).map((x) => [x.coin, x])));
    setUsdSek(c.data?.usd_sek ? +c.data.usd_sek : null);
  };
  useEffect(() => { load(); const id = setInterval(load, 30_000); return () => clearInterval(id); }, []);

  const sek = (usd: number) => (usdSek ? usd * usdSek : null);
  const pnl = (p: Pos) => {
    const q = quotes[p.coin];
    return q ? unrealized(p.side, +p.entry_px, +q.mid, +p.size, +p.funding_usd, +p.margin_usd) : null;
  };
  const open = pos.filter((p) => p.status === "open");
  const closed = pos.filter((p) => p.status === "closed");
  const oldest = Object.values(quotes).reduce((m, q) => Math.min(m, Date.parse(q.updated_at)), Infinity);
  const stale = !Object.keys(quotes).length || Date.now() - oldest > 15 * 60_000;

  const chart = useMemo(() => {
    if (!usdSek) return [];
    const byHour = new Map<string, Record<string, number | string>>();
    for (const e of eq) {
      const b = books.find((x) => x.id === e.book);
      if (!b || e.attempt !== b.attempt) continue;
      const k = e.t.slice(0, 13);
      const row = byHour.get(k) ?? { t: time(e.t) };
      row[e.book] = +(+e.equity_usd * usdSek).toFixed(2);
      byHour.set(k, row);
    }
    return [...byHour.values()];
  }, [eq, books, usdSek]);

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-sm tracking-[0.3em] text-neon">FX DESK · PAPER</h1>
        <span className="text-[11px] text-muted-foreground">Hyperliquid xyz perps · EUR · JPY · GBP · GOLD · SILVER · traded by Claude</span>
      </header>
      {err && <div className="rounded border border-destructive p-2 text-xs text-destructive">{err}</div>}
      {stale && (
        <div role="alert" className="rounded border border-destructive/70 bg-destructive/10 p-2 text-xs text-destructive">
          Prices are older than 15 minutes{isFinite(oldest) ? ` (last update ${time(new Date(oldest).toISOString())})` : ""}. Live P&L and new trades wait for fresh prices.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {books.map((b) => {
          const mine = open.filter((p) => p.book === b.id);
          const unreal = mine.reduce((a, p) => a + (pnl(p) ?? 0), 0);
          const equity = +b.cash_usd + unreal;
          const eqSek = sek(equity);
          const progress = eqSek == null ? 0 : Math.min(100, Math.max(0, ((eqSek - +b.start_sek) / (+b.target_sek - +b.start_sek)) * 100));
          const ret = ((equity / +b.start_usd) - 1) * 100;
          const risk = mine.reduce((a, p) => a + Math.max(0, (p.side === "long" ? 1 : -1) * (+p.entry_px - +p.stop_px)) * +p.size, 0);
          const done = closed.filter((p) => p.book === b.id && p.attempt === b.attempt);
          const wins = done.filter((p) => +(p.net_usd ?? 0) > 0).length;
          const busted = b.status === "busted";
          return (
            <section key={b.id} className={`panel rounded-lg p-4 ${busted ? "border border-destructive" : ""}`}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-xs tracking-[0.3em]" style={{ color: COLORS[b.id] }}>{b.name.toUpperCase()}</h2>
                <span className="text-[11px] text-muted-foreground">ATTEMPT {b.attempt} · <span className={busted ? "text-destructive" : "text-neon"}>{busted ? "BUSTED" : "ACTIVE"}</span></span>
              </div>
              <div className="flex flex-wrap items-baseline gap-x-4">
                <span className="text-2xl tabular-nums">{f(eqSek)} SEK</span>
                <span className="text-xs tabular-nums text-muted-foreground">${f(equity)}</span>
                <span className={`text-xs tabular-nums ${ret >= 0 ? "text-neon" : "text-destructive"}`}>{ret >= 0 ? "+" : ""}{f(ret)}%</span>
              </div>
              <div className="mt-3">
                <div className="h-2 overflow-hidden rounded bg-terminal"><div className="h-full" style={{ width: `${progress}%`, background: COLORS[b.id] }} /></div>
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground"><span>{f(+b.start_sek, 0)} SEK</span><span>{f(progress, 1)}%</span><span>{Number(b.target_sek).toLocaleString("sv-SE")} SEK</span></div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div><dt className="text-[10px] text-muted-foreground">OPEN RISK</dt><dd className="tabular-nums">{f(sek(risk))} SEK</dd></div>
                <div><dt className="text-[10px] text-muted-foreground">OPEN</dt><dd className="tabular-nums">{mine.length}/{b.max_open}</dd></div>
                <div><dt className="text-[10px] text-muted-foreground">TRADES</dt><dd className="tabular-nums">{done.length}</dd></div>
                <div><dt className="text-[10px] text-muted-foreground">WIN RATE</dt><dd className="tabular-nums">{done.length ? f((wins / done.length) * 100, 0) + "%" : "—"}</dd></div>
              </dl>
              <div className="mt-2 text-[10px] text-muted-foreground">Max {f(+b.max_leverage, 0)}x · risk ≤ {f(+b.max_risk_pct, 1)}% · {b.daily_loss_pct != null ? `daily loss stop ${f(+b.daily_loss_pct, 1)}%` : "no daily loss stop"}</div>
              {busted && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button className="mt-3 rounded border border-destructive px-3 py-1 text-xs tracking-widest text-destructive hover:bg-destructive/10">RESET BOOK</button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Reset {b.name}?</AlertDialogTitle>
                      <AlertDialogDescription>Starts attempt {b.attempt + 1} with a fresh {f(+b.start_sek, 0)} SEK of paper money. Earlier trades stay in the history.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={async () => {
                        try { await reset({ data: { book: b.id as "sprint" | "steady" } }); await load(); }
                        catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
                      }}>Reset</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </section>
          );
        })}
      </div>

      <Panel title="EQUITY (SEK)">
        {chart.length < 2 ? <div className="text-xs text-muted-foreground">The curve fills in hour by hour once the engine runs.</div> : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chart}>
                <XAxis dataKey="t" tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} minTickGap={40} />
                <YAxis tick={{ fontSize: 10, fill: "var(--muted-foreground)" }} domain={[0, (max: number) => Math.max(1050, max)]} />
                <Tooltip contentStyle={{ background: "var(--terminal)", border: "1px solid var(--border)", color: "var(--foreground)", fontSize: 11 }} itemStyle={{ color: "var(--foreground)" }} labelStyle={{ color: "var(--foreground)" }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <ReferenceLine y={1000} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
                {books.map((b) => <Line key={b.id} dataKey={b.id} name={b.name} stroke={COLORS[b.id]} dot={false} strokeWidth={1.5} connectNulls />)}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>

      <Panel title="OPEN POSITIONS">
        {open.length === 0 ? <div className="text-xs text-muted-foreground">No open positions.</div> : (
          <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-xs">
            <thead className="text-muted-foreground"><tr className="text-left"><th>COIN</th><th>BOOK</th><th>SIDE</th><th>ENTRY</th><th>STOP</th><th>TARGET</th><th>LIQ</th><th>LEV</th><th>NOTIONAL</th><th>P&L SEK</th><th>OPENED</th></tr></thead>
            <tbody>{open.map((p) => {
              const v = pnl(p);
              return (
                <tr key={p.id} title={p.thesis ?? undefined} className="cursor-help border-t border-border/50">
                  <td>{short(p.coin)}</td><td>{p.book.toUpperCase()}</td><td>{p.side.toUpperCase()}</td>
                  <td className="tabular-nums">{px(+p.entry_px)}</td><td className="tabular-nums">{px(+p.stop_px)}</td>
                  <td className="tabular-nums">{px(p.target_px)}</td><td className="tabular-nums">{px(+p.liq_px)}</td>
                  <td className="tabular-nums">{f(+p.leverage, 1)}x</td><td className="tabular-nums">${f(+p.notional_usd)}</td>
                  <td className={`tabular-nums ${(v ?? 0) >= 0 ? "text-neon" : "text-destructive"}`}>{v == null ? "—" : f(sek(v))}</td>
                  <td>{time(p.opened_at)}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Panel>

      <Panel title="TRADE DOTS (R)">
        <div className="grid gap-4 md:grid-cols-2">
          {books.map((b) => {
            const trades: GridTrade[] = closed.filter((p) => p.book === b.id && p.net_r != null && p.closed_at).reverse().map((p) => ({
              id: p.id, coin: short(p.coin), side: p.side, setup: `attempt ${p.attempt}`, trader: null,
              exitT: p.closed_at!, exitReason: p.exit_reason, result: +p.net_r!, usd: p.net_usd != null ? +p.net_usd : null,
            }));
            const s = stats(trades, "R");
            return (
              <div key={b.id}>
                <div className="mb-2 flex justify-between text-[11px]"><span style={{ color: COLORS[b.id] }}>{b.name.toUpperCase()}</span>
                  <span className="text-muted-foreground">{s.trades} trades · win {s.winRate == null ? "—" : f(s.winRate, 0) + "%"} · total {f(s.total)}R</span></div>
                {trades.length ? <Dots trades={trades} unit="R" clusters={sameHourClusters(trades)} /> : <div className="text-xs text-muted-foreground">No closed trades yet.</div>}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="CLOSED TRADES">
        {closed.length === 0 ? <div className="text-xs text-muted-foreground">No closed trades yet.</div> : (
          <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-xs">
            <thead className="text-muted-foreground"><tr className="text-left"><th>COIN</th><th>BOOK</th><th>#</th><th>SIDE</th><th>ENTRY</th><th>EXIT</th><th>REASON</th><th>NET SEK</th><th>NET R</th><th>CLOSED</th></tr></thead>
            <tbody>{closed.slice(0, 200).map((p) => (
              <tr key={p.id} title={p.thesis ?? undefined} className="border-t border-border/50">
                <td>{short(p.coin)}</td><td>{p.book.toUpperCase()}</td><td>{p.attempt}</td><td>{p.side.toUpperCase()}</td>
                <td className="tabular-nums">{px(+p.entry_px)}</td><td className="tabular-nums">{px(p.exit_px)}</td><td>{p.exit_reason}</td>
                <td className={`tabular-nums ${+(p.net_usd ?? 0) >= 0 ? "text-neon" : "text-destructive"}`}>{f(sek(+(p.net_usd ?? 0)))}</td>
                <td className="tabular-nums">{f(p.net_r)}</td><td>{time(p.closed_at)}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Panel>
    </main>
  );
}
