import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  classify, stats, sameHourClusters, groupTrades, traderLabel,
  type GridTrade, type Unit, type Outcome, type GroupKey, type Stats,
} from "@/lib/desk/trade-grid";

type Source = "paper" | "shadow" | "mimic";
type ShadowSub = "all" | "vetoed" | "risk";

interface PaperRow { coin: string; side: string; setup: string; exit_t: string | null; exit_reason: string | null; net_r: number | null; net_usd: number | null; shadow: boolean; shadow_reason: string | null; follow_wallets: string[] | null }
interface MimicRow { address: string; coin: string; side: string; closed_at: string | null; exit_reason: string | null; net_pct: number | null; net_usd: number | null }

const LOSS = "#8b1a1a";
const dotStyle = (o: Outcome): React.CSSProperties => {
  switch (o) {
    case "big_win": return { background: "var(--neon)" };
    case "win": return { background: "color-mix(in oklab, var(--neon) 45%, transparent)" };
    case "big_loss": return { background: LOSS };
    case "loss": return { background: `color-mix(in oklab, ${LOSS} 45%, transparent)` };
    default: return { background: "var(--muted-foreground)", opacity: 0.5 };
  }
};

const stockholm = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Stockholm", dateStyle: "short", timeStyle: "short" });
const fmtRes = (v: number, u: Unit) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}${u}`;

function Sel<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <label className="flex items-center gap-1 text-[10px] tracking-widest text-muted-foreground">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value as T)} className="rounded border border-border bg-terminal px-1.5 py-0.5 text-[11px] text-foreground">
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`rounded border px-2 py-1 text-[11px] tracking-widest ${on ? "border-neon text-neon" : "border-border text-muted-foreground hover:text-foreground"}`}>{children}</button>
  );
}

function Dots({ trades, unit, clusters, empties = 0 }: { trades: GridTrade[]; unit: Unit; clusters: Map<string, number>; empties?: number }) {
  return (
    <div className="flex flex-wrap gap-1">
      {trades.map((t) => {
        const others = clusters.get(t.id) ?? 0;
        const tip = [
          `${t.coin} ${t.side.toUpperCase()}${t.setup ? ` · ${t.setup}` : ""}`,
          `Trader: ${t.trader ?? "None"}`,
          `Exit: ${stockholm.format(new Date(t.exitT))}`,
          `Result: ${fmtRes(t.result, unit)}`,
          `Reason: ${t.exitReason ?? "—"}`,
          others > 0 ? `Closed in the same hour as ${others} other trade${others > 1 ? "s" : ""}: one market move, not separate bets.` : "",
        ].filter(Boolean).join("\n");
        return (
          <span key={t.id} title={tip} className="inline-block h-3 w-3 shrink-0 rounded-full"
            style={{ ...dotStyle(classify(t.result, unit)), ...(others > 0 ? { boxShadow: "0 0 0 1px color-mix(in oklab, var(--foreground) 70%, transparent)" } : {}) }} />
        );
      })}
      {Array.from({ length: empties }).map((_, i) => (
        <span key={`e${i}`} className="inline-block h-3 w-3 shrink-0 rounded-full border border-border" />
      ))}
    </div>
  );
}

function fmtStat(v: number | null, u: Unit) { return v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}${u}`; }

export function TradeGrid({ usdSek }: { usdSek: number | null }) {
  const [paper, setPaper] = useState<PaperRow[]>([]);
  const [mimic, setMimic] = useState<MimicRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const [source, setSource] = useState<Source>("paper");
  const [sub, setSub] = useState<ShadowSub>("all");
  const [setup, setSetup] = useState("all");
  const [side, setSide] = useState("all");
  const [coin, setCoin] = useState("all");
  const [trader, setTrader] = useState("all");
  const [period, setPeriod] = useState<"all" | "30" | "7">("all");
  const [group, setGroup] = useState<GroupKey>("none");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [p, m] = await Promise.all([
        supabase.from("paper_positions").select("coin,side,setup,exit_t,exit_reason,net_r,net_usd,shadow,shadow_reason,follow_wallets").eq("status", "closed").order("exit_t", { ascending: true }).limit(5000),
        supabase.from("mimic_trades").select("address,coin,side,closed_at,exit_reason,net_pct,net_usd").eq("status", "closed").order("closed_at", { ascending: true }).limit(5000),
      ]);
      if (!alive) return;
      if (p.error || m.error) setErr((p.error ?? m.error)!.message); else setErr(null);
      const pr = (p.data ?? []) as PaperRow[];
      const mr = (m.data ?? []) as MimicRow[];
      setPaper(pr); setMimic(mr);
      const addrs = [...new Set([...pr.flatMap((r) => r.follow_wallets ?? []), ...mr.map((r) => r.address)])];
      const map: Record<string, string> = {};
      for (let i = 0; i < addrs.length; i += 200) {
        const { data } = await supabase.from("sm_wallets").select("address,display_name").in("address", addrs.slice(i, i + 200));
        for (const w of data ?? []) if (w.display_name) map[w.address] = w.display_name;
      }
      if (alive) setNames(map);
    };
    load();
    const id = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const unit: Unit = source === "mimic" ? "%" : "R";

  const base: GridTrade[] = useMemo(() => {
    const lbl = (a: string) => traderLabel(a, names[a]);
    if (source === "mimic") {
      return mimic.filter((r) => r.closed_at && r.net_pct != null).map((r, i) => ({
        id: `m${i}`, coin: r.coin, side: r.side, setup: null, trader: lbl(r.address), exitT: r.closed_at!, exitReason: r.exit_reason, result: +r.net_pct!, usd: r.net_usd != null ? +r.net_usd : null,
      }));
    }
    return paper
      .filter((r) => r.exit_t && r.net_r != null && (source === "paper" ? !r.shadow : r.shadow && (sub === "all" || r.shadow_reason === sub)))
      .map((r, i) => ({
        id: `p${i}`, coin: r.coin, side: r.side, setup: r.setup, trader: r.follow_wallets?.length ? r.follow_wallets.map(lbl).join(", ") : null,
        exitT: r.exit_t!, exitReason: r.exit_reason, result: +r.net_r!, usd: r.net_usd != null ? +r.net_usd : null,
      }));
  }, [source, sub, paper, mimic, names]);

  const opts = useMemo(() => {
    const u = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort();
    return { setups: u(base.map((t) => t.setup)), coins: u(base.map((t) => t.coin)), traders: u(base.map((t) => t.trader)) };
  }, [base]);

  const view = useMemo(() => {
    const cutoff = period === "all" ? 0 : Date.now() - +period * 86_400_000;
    return base.filter((t) =>
      (setup === "all" || t.setup === setup) &&
      (side === "all" || t.side.toLowerCase() === side) &&
      (coin === "all" || t.coin === coin) &&
      (trader === "all" || (trader === "__none" ? t.trader == null : t.trader === trader)) &&
      (!cutoff || new Date(t.exitT).getTime() >= cutoff));
  }, [base, setup, side, coin, trader, period]);

  const s = stats(view, unit);
  const clusters = useMemo(() => sameHourClusters(view), [view]);
  const groups = group === "none" ? null : groupTrades(view, group, unit);
  const showTarget = source !== "mimic";

  const totalText = (st: Stats) => unit === "%"
    ? `$${st.totalUsd.toFixed(2)}${usdSek ? ` · ${(st.totalUsd * usdSek).toFixed(0)} SEK` : ""}`
    : fmtStat(st.total, "R");

  const cards: [string, string][] = [
    ["TRADES", String(s.trades)],
    ["WIN RATE", s.winRate == null ? "—" : `${s.winRate.toFixed(0)}%`],
    ["AVG / TRADE", fmtStat(s.avg, unit)],
    ["TOTAL", totalText(s)],
    ["PROFIT FACTOR", s.profitFactor == null ? "—" : s.profitFactor.toFixed(2)],
    ["INDEPENDENT BETS", String(s.independent)],
  ];

  const changeSource = (v: Source) => { setSource(v); setSetup("all"); setCoin("all"); setTrader("all"); };

  return (
    <section className="panel rounded-lg p-4">
      <h2 className="mb-3 text-xs tracking-[0.3em] text-neon">TRADE GRID</h2>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Chip on={source === "paper"} onClick={() => changeSource("paper")}>PAPER</Chip>
        <Chip on={source === "shadow"} onClick={() => changeSource("shadow")}>VETOED + RISK-BLOCKED</Chip>
        <Chip on={source === "mimic"} onClick={() => changeSource("mimic")}>INVO MIMIC COPIES</Chip>
        {source === "shadow" && (
          <span className="ml-2 flex gap-1">
            <Chip on={sub === "all"} onClick={() => setSub("all")}>ALL</Chip>
            <Chip on={sub === "vetoed"} onClick={() => setSub("vetoed")}>VETOED</Chip>
            <Chip on={sub === "risk"} onClick={() => setSub("risk")}>BLOCKED BY RISK</Chip>
          </span>
        )}
      </div>
      <div className="mb-3 flex flex-wrap gap-3">
        {source !== "mimic" && <Sel label="SETUP" value={setup} onChange={setSetup} options={[{ v: "all", l: "All" }, ...opts.setups.map((x) => ({ v: x, l: x }))]} />}
        <Sel label="SIDE" value={side} onChange={setSide} options={[{ v: "all", l: "All" }, { v: "long", l: "Long" }, { v: "short", l: "Short" }]} />
        <Sel label="COIN" value={coin} onChange={setCoin} options={[{ v: "all", l: "All" }, ...opts.coins.map((x) => ({ v: x, l: x }))]} />
        <Sel label="TRADER" value={trader} onChange={setTrader} options={[{ v: "all", l: "All" }, { v: "__none", l: "None" }, ...opts.traders.map((x) => ({ v: x, l: x }))]} />
        <Sel label="PERIOD" value={period} onChange={setPeriod} options={[{ v: "all", l: "All" }, { v: "30", l: "30 days" }, { v: "7", l: "7 days" }]} />
        <Sel label="GROUP BY" value={group} onChange={setGroup} options={[{ v: "none", l: "None" }, ...(source !== "mimic" ? [{ v: "setup" as const, l: "Setup" }] : []), { v: "trader", l: "Trader" }, { v: "coin", l: "Coin" }, { v: "side", l: "Side" }]} />
      </div>
      {err && <div className="mb-2 text-[11px] text-destructive">{err}</div>}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map(([k, v]) => (
          <div key={k} className="rounded border border-border bg-terminal px-3 py-2">
            <div className="text-[10px] tracking-widest text-muted-foreground">{k}</div>
            <div className="tabular-nums text-sm text-foreground">{v}</div>
          </div>
        ))}
      </div>
      {view.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">No closed trades in this view.</div>
      ) : groups ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[11px]">
            <thead className="text-muted-foreground"><tr className="text-left"><th className="py-1 pr-3">GROUP</th><th className="pr-3">DOTS</th><th className="pr-3 text-right">TRADES</th><th className="pr-3 text-right">WIN %</th><th className="pr-3 text-right">AVG</th><th className="text-right">TOTAL</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name} className="border-t border-border align-top">
                  <td className="whitespace-nowrap py-1.5 pr-3 text-foreground">{g.name}</td>
                  <td className="py-1.5 pr-3"><Dots trades={g.trades} unit={unit} clusters={clusters} /></td>
                  <td className="pr-3 text-right tabular-nums">{g.stats.trades}</td>
                  <td className="pr-3 text-right tabular-nums">{g.stats.winRate == null ? "—" : `${g.stats.winRate.toFixed(0)}%`}</td>
                  <td className="pr-3 text-right tabular-nums">{fmtStat(g.stats.avg, unit)}</td>
                  <td className="whitespace-nowrap text-right tabular-nums">{totalText(g.stats)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Dots trades={view} unit={unit} clusters={clusters} empties={showTarget ? Math.max(0, 100 - view.length) : 0} />
      )}
      {showTarget && view.length > 0 && (
        <p className="mt-3 text-[11px] text-muted-foreground">
          {view.length >= 100 ? "Sample of 100+ reached." : `${view.length} of 100 trades toward a sample worth judging.`} Shade = size of the result; judge by average and total, not win rate.
        </p>
      )}
    </section>
  );
}
