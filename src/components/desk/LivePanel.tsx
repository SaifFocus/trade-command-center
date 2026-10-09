import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { liveStatusFn, smokeTestFn, armLiveFn, disarmLiveFn, killLiveFn, reconcileLiveFn, taxExportFn } from "@/lib/live/live.functions";

// Real-money controls: status checklist, smoke test, GO LIVE arming, disarm, KILL, live positions and orders.
type Status = Awaited<ReturnType<typeof liveStatusFn>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const fmt = (n: unknown, d = 2) => (n == null || !isFinite(Number(n)) ? "—" : Number(n).toFixed(d));
const time = (s: string | null) => (s ? new Date(s).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }).slice(0, 16) : "—");

function Light({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${ok == null ? "bg-muted-foreground" : ok ? "bg-neon" : "bg-destructive"}`} />
      <span>{label}{detail ? <span className="text-muted-foreground"> · {detail}</span> : null}</span>
    </li>
  );
}

export function LivePanel({ usdSek }: { usdSek: number | null }) {
  const getStatus = useServerFn(liveStatusFn);
  const smoke = useServerFn(smokeTestFn);
  const arm = useServerFn(armLiveFn);
  const disarm = useServerFn(disarmLiveFn);
  const kill = useServerFn(killLiveFn);
  const reconcile = useServerFn(reconcileLiveFn);
  const taxExport = useServerFn(taxExportFn);
  const [st, setSt] = useState<Status | null>(null);
  const [pos, setPos] = useState<Row[]>([]);
  const [orders, setOrders] = useState<Row[]>([]);
  const [phrase, setPhrase] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [killing, setKilling] = useState(false);
  const [armSmoke, setArmSmoke] = useState(false);

  const load = async () => {
    try { setSt(await getStatus()); } catch (e) { setMsg(`status error: ${e instanceof Error ? e.message : e}`); }
    const [p, o] = await Promise.all([
      supabase.from("live_positions" as never).select("*").order("entry_t", { ascending: false }).limit(30),
      supabase.from("live_orders" as never).select("*").order("created_at", { ascending: false }).limit(20),
    ]);
    setPos((p.data ?? []) as Row[]);
    setOrders((o.data ?? []) as Row[]);
  };
  useEffect(() => { load(); const id = setInterval(load, 60_000); return () => clearInterval(id); }, []);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true); setMsg(`${label}...`);
    try { const r = await fn(); setMsg(`${label} · ${JSON.stringify(r)}`); }
    catch (e) { setMsg(`${label} ERROR: ${e instanceof Error ? e.message : String(e)}`); }
    setBusy(false); setArmSmoke(false); setPhrase(""); await load();
  };

  const downloadK4 = async () => {
    const year = new Date().getFullYear();
    try {
      const r = await taxExport({ data: { year } });
      const url = URL.createObjectURL(new Blob(["\ufeff" + r.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url; a.download = `apex-k4-${year}.csv`; a.click();
      URL.revokeObjectURL(url);
      setMsg(`K4 ${year}: ${r.summary.trades} trades · gains ${r.summary.gains_sek} SEK · losses ${r.summary.losses_sek} SEK · estimated tax ${r.summary.tax_estimate_sek} SEK (check with Skatteverket)`);
    } catch (e) { setMsg(`K4 export error: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const smokeOk = !!st?.smokePassedAt && Date.now() - Date.parse(st.smokePassedAt) < 7 * 86400_000;
  const sek = (usd: number | null | undefined) => (usd != null && usdSek ? ` ≈ ${fmt(usd * usdSek, 0)} SEK` : "");
  const active = pos.filter((p) => ["opening", "open", "closing"].includes(p.status));
  const closed = pos.filter((p) => p.status === "closed");

  return (
    <section className={`panel rounded-lg p-4 ${st?.armed ? "border border-destructive" : ""}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs tracking-[0.3em] text-neon">LIVE TRADING · REAL MONEY</h2>
        <span className={`text-xs tracking-widest ${st?.armed ? "text-destructive" : "text-muted-foreground"}`}>
          {st?.armed ? `ARMED ON ${st.network.toUpperCase()}${st.dryRun ? " (DRY RUN)" : ""}` : "NOT ARMED — PAPER ONLY"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ul className="space-y-1 text-xs">
          <Light ok={st ? st.configured : null} label="Secrets added" detail={st && !st.configured ? `missing ${st.missing.join(", ")}` : st?.account ? `account ${st.account}` : undefined} />
          <Light ok={st ? st.agentOk : null} label="Trade-only key approved" detail={st ? `${st.agentDetail}${st.agentName ? ` (${st.agentName})` : ""}${st.agentValidUntil ? ` · valid until ${time(new Date(st.agentValidUntil).toISOString())}` : ""}` : undefined} />
          <Light ok={st ? st.network === "mainnet" : null} label={`Network: ${st?.network ?? "—"}`} detail={st?.network === "testnet" ? "practice money" : st?.network === "mainnet" ? "real money" : undefined} />
          <Light ok={st ? (st.accountValueUsd ?? 0) >= 11 : null} label={`Account $${fmt(st?.accountValueUsd)}${sek(st?.accountValueUsd)}`} detail={`free $${fmt(st?.withdrawableUsd)}`} />
          <Light ok={st ? smokeOk : null} label="Smoke test passed" detail={st?.smokePassedAt ? time(st.smokePassedAt) : "not yet"} />
          <Light ok={st ? !st.killSwitch : null} label={`Kill switch ${st?.killSwitch ? "ON" : "off"}`} />
          <Light ok={st ? st.openExchangePositions === 0 || st.armed : null} label={`Exchange: ${st?.openExchangePositions ?? 0} positions, ${st?.openExchangeOrders ?? 0} orders`} />
        </ul>

        <div className="space-y-2 text-xs">
          {!armSmoke ? (
            <button disabled={busy || !st?.configured || st?.armed} onClick={() => setArmSmoke(true)}
              className="w-full rounded border border-border bg-terminal px-3 py-1.5 tracking-widest text-neon hover:opacity-80 disabled:opacity-40">
              RUN SMOKE TEST
            </button>
          ) : (
            <button disabled={busy} onClick={() => act("SMOKE TEST", () => smoke())}
              className="w-full rounded border border-destructive px-3 py-1.5 tracking-widest text-destructive hover:opacity-80 disabled:opacity-40">
              CONFIRM: BUY AND SELL ~$11 OF BTC NOW
            </button>
          )}
          {!st?.armed ? (
            <div className="space-y-1">
              <input value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder='type GO LIVE' maxLength={20}
                className="w-full rounded border border-border bg-terminal px-2 py-1.5 font-mono text-xs" />
              <button disabled={busy || !st?.canArm || phrase !== "GO LIVE"} onClick={() => act("ARM", () => arm({ data: { phrase } }))}
                className="w-full rounded border border-destructive px-3 py-1.5 tracking-widest text-destructive hover:opacity-80 disabled:opacity-40">
                ARM LIVE TRADING
              </button>
              {st && st.blockers.length > 0 && <div className="text-muted-foreground">Before arming: {st.blockers.join(" · ")}</div>}
            </div>
          ) : (
            <button disabled={busy} onClick={() => act("DISARM", () => disarm())}
              className="w-full rounded border border-border px-3 py-1.5 tracking-widest text-muted-foreground hover:text-neon disabled:opacity-40">
              DISARM (KEEP POSITIONS, STOP NEW ENTRIES)
            </button>
          )}
          <button disabled={killing} onClick={async () => { setKilling(true); try { setMsg(`KILL · ${JSON.stringify(await kill())}`); } catch (e) { setMsg(`KILL ERROR: ${e instanceof Error ? e.message : String(e)}`); } setKilling(false); await load(); }}
            className="w-full rounded border border-destructive bg-destructive/10 px-3 py-2 font-bold tracking-widest text-destructive hover:opacity-80 disabled:opacity-40">
            {killing ? "KILLING…" : "KILL — CLOSE EVERYTHING NOW"}
          </button>
          <button disabled={busy || !st?.configured} onClick={() => act("RECONCILE", () => reconcile())}
            className="w-full rounded border border-border px-3 py-1 tracking-widest text-muted-foreground hover:text-neon disabled:opacity-40">
            CHECK AGAINST EXCHANGE NOW
          </button>
          <button onClick={downloadK4}
            className="w-full rounded border border-border px-3 py-1 tracking-widest text-muted-foreground hover:text-neon">
            DOWNLOAD K4 CSV (THIS YEAR)
          </button>
        </div>

        <div className="space-y-1 text-xs text-muted-foreground">
          <div>Live only takes signals the paper desk takes, sized from min(account, 600 SEK budget).</div>
          <div>Each trade: isolated margin, 5x BTC/ETH, 3x others; at most $200 and 2.5× equity; at most 6 entries a day.</div>
          <div>Every position has a resting stop on Hyperliquid. Checked every 2 minutes. Kill switch trips at a 15% loss, or after three failed safety checks in a row.</div>
          <div className="break-all font-mono text-[11px]">{msg}</div>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-muted-foreground"><tr className="text-left"><th>COIN</th><th>SIDE</th><th>SETUP</th><th>STATUS</th><th>ENTRY</th><th>SIZE</th><th>STOP</th><th>T1/T2</th><th>RISK</th><th>NET $</th><th>OPENED</th><th>NOTE</th></tr></thead>
          <tbody>
            {[...active, ...closed].length === 0 ? (
              <tr><td colSpan={12} className="py-2 text-muted-foreground">No live trades yet.</td></tr>
            ) : [...active, ...closed].map((p) => (
              <tr key={p.id} className="border-t border-border/50">
                <td>{p.coin}</td><td>{String(p.side).toUpperCase()}</td><td>{p.setup}</td>
                <td className={p.status === "open" ? "text-neon" : p.status === "closed" ? "" : "text-destructive"}>{String(p.status).toUpperCase()}{p.close_reason ? ` · ${p.close_reason}` : ""}</td>
                <td className="tabular-nums">{p.entry_px ? Number(p.entry_px).toPrecision(6) : "—"}</td>
                <td className="tabular-nums">{fmt(p.size, 5)}</td>
                <td className="tabular-nums">{Number(p.stop_px).toPrecision(6)}{p.be_moved ? " (BE)" : ""}</td>
                <td className="tabular-nums">{p.t1_px ? `${Number(p.t1_px).toPrecision(5)} / ${Number(p.t2_px).toPrecision(5)}` : "—"}</td>
                <td className="tabular-nums">${fmt(p.risk_usd)}</td>
                <td className={`tabular-nums ${Number(p.net_usd ?? 0) >= 0 ? "text-neon" : "text-destructive"}`}>{p.net_usd == null ? "—" : fmt(p.net_usd)}</td>
                <td>{time(p.entry_t)}</td>
                <td className="max-w-[260px] truncate text-muted-foreground" title={p.note ?? ""}>{p.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Recent live orders ({orders.length})</summary>
        <div className="overflow-x-auto"><table className="mt-2 w-full">
          <thead className="text-muted-foreground"><tr className="text-left"><th>TIME</th><th>KIND</th><th>COIN</th><th>SIDE</th><th>PX</th><th>TRIGGER</th><th>SIZE</th><th>STATUS</th><th>ERROR</th></tr></thead>
          <tbody>{orders.map((o) => (
            <tr key={o.id} className="border-t border-border/50">
              <td>{time(o.created_at)}</td><td>{o.kind}{o.dry_run ? " (dry)" : ""}</td><td>{o.coin}</td><td>{o.is_buy ? "BUY" : "SELL"}</td>
              <td className="tabular-nums">{o.px}</td><td className="tabular-nums">{o.trigger_px ?? ""}</td><td className="tabular-nums">{o.size}</td>
              <td>{o.status}</td><td className="text-destructive">{o.error ?? ""}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </details>
    </section>
  );
}
