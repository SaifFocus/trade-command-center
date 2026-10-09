import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { syncUniverseFn, syncCoinFn, runBacktestFn } from "@/lib/hl/hl.functions";

export const Route = createFileRoute("/backtest")({
  head: () => ({
    meta: [
      { title: "Backtest — APEX Crypto Swing Desk" },
      { name: "description", content: "Hyperliquid market-data sync and swing-setup backtests in R-multiples." },
      { property: "og:title", content: "Backtest — APEX Crypto Swing Desk" },
      { property: "og:description", content: "Swing setup backtests on Hyperliquid public data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BacktestPage,
});

type Run = { id: string; created_at: string | null; status: string | null; error: string | null; params: any; summary: any };
const SETUPS = ["pullback_long", "breakout_retest_long", "breakdown_retest_short", "crowded_long_squeeze_short"];

function BacktestPage() {
  const syncUniverse = useServerFn(syncUniverseFn);
  const syncCoin = useServerFn(syncCoinFn);
  const runBt = useServerFn(runBacktestFn);
  const [status, setStatus] = useState("IDLE");
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);

  const loadRuns = async () => {
    const { data } = await supabase.from("backtest_runs").select("*").eq("status", "done").order("created_at", { ascending: false }).limit(2);
    setRuns((data ?? []) as Run[]);
  };
  useEffect(() => { loadRuns(); }, []);

  const doSync = async () => {
    setBusy(true);
    try {
      setStatus("FETCHING UNIVERSE...");
      const { coins } = await syncUniverse();
      for (let i = 0; i < coins.length; i++) {
        setStatus(`SYNCING ${coins[i]} (${i + 1}/${coins.length})...`);
        await syncCoin({ data: { coin: coins[i] } });
      }
      setStatus(`SYNC COMPLETE · ${coins.length} COINS`);
    } catch (e) { setStatus(`ERROR: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(false);
  };
  const doRun = async () => {
    setBusy(true);
    setStatus("RUNNING BACKTEST (2 CONFIGS)...");
    try { await runBt(); setStatus("BACKTEST COMPLETE"); await loadRuns(); }
    catch (e) { setStatus(`ERROR: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(false);
  };

  return (
    <div className="min-h-screen">
      <header className="panel border-b">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between px-6 py-4">
          <h1 className="text-neon font-display text-2xl font-black tracking-[0.2em]">APEX · BACKTEST</h1>
          <Link to="/" className="text-xs tracking-widest text-muted-foreground hover:text-neon">← DASHBOARD</Link>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] px-6 py-6 space-y-6">
        <div className="panel rounded-lg p-4 flex flex-wrap items-center gap-3">
          <button disabled={busy} onClick={doSync} className="rounded border border-border bg-terminal px-4 py-2 text-xs tracking-widest text-neon disabled:opacity-40">SYNC MARKET DATA</button>
          <button disabled={busy} onClick={doRun} className="rounded border border-border bg-terminal px-4 py-2 text-xs tracking-widest text-gold disabled:opacity-40">RUN BACKTEST</button>
          <span className="font-mono text-xs tracking-widest text-muted-foreground">STATUS: <span className="text-foreground">{status}</span></span>
        </div>
        {runs.length === 0 && <div className="panel rounded-lg p-4 text-xs tracking-widest text-muted-foreground">NO COMPLETED RUNS YET</div>}
        {runs.map((r) => <RunTable key={r.id} run={r} />)}
      </main>
    </div>
  );
}

function RunTable({ run }: { run: Run }) {
  const s = run.summary ?? {};
  const rows: [string, any][] = [
    ...SETUPS.flatMap((k) => (["in", "out"] as const).map((smp) => [`${k} · ${smp}`, s.by_setup_sample?.[`${k}:${smp}`]] as [string, any])),
    ["ALL · in", s.in], ["ALL · out", s.out], ["ALL", s.all],
  ];
  const g = s.gate ?? {};
  return (
    <section className="panel rounded-lg p-4">
      <h2 className="text-xs tracking-[0.3em] text-neon mb-3">
        {s.config ?? run.params?.name} · {run.created_at ? new Date(run.created_at).toISOString().slice(0, 16).replace("T", " ") : ""} UTC ·
        GATE <span className={g.pass ? "text-neon" : "text-destructive"}>{g.pass ? "PASS" : "FAIL"}</span>
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-xs">
          <thead className="text-muted-foreground">
            <tr>{["SETUP · SAMPLE", "TRADES", "WIN%", "AVG R", "EXP R", "PF", "MDD R", "RET %", "MDD %"].map((h) => <th key={h} className="text-left py-1 pr-4 font-normal tracking-widest">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(([label, v]) => (
              <tr key={label} className="border-t border-border">
                <td className="py-1 pr-4 text-foreground">{label}</td>
                <td className="pr-4">{v?.trades ?? 0}</td>
                <td className="pr-4">{v ? (v.win_rate * 100).toFixed(1) : "-"}</td>
                <td className={`pr-4 ${v?.avg_net_r > 0 ? "text-neon" : "text-destructive"}`}>{v?.avg_net_r ?? "-"}</td>
                <td className="pr-4">{v?.expectancy_r ?? "-"}</td>
                <td className="pr-4">{v?.profit_factor ?? "-"}</td>
                <td className="pr-4">{v?.max_drawdown_r ?? "-"}</td>
                <td className="pr-4">{v?.final_return_pct ?? "-"}</td>
                <td className="pr-4">{v?.max_drawdown_pct ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
