import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { Market } from "@/lib/dashboard-data";

export function PortfolioSummary({ markets }: { markets: Market[] }) {
  const totalDeployed = markets.reduce((a, m) => a + m.seed, 0);
  const totalCurrent = markets.reduce((a, m) => a + m.current, 0);
  const pnl = totalCurrent - totalDeployed;
  const pnlPct = totalDeployed > 0 ? (pnl / totalDeployed) * 100 : 0;
  const best = markets.slice().sort((a, b) => (b.current - b.seed) - (a.current - a.seed))[0];

  const data = markets.map((m) => ({ name: m.name, value: m.seed, color: m.color }));

  const stat = (label: string, val: React.ReactNode, cls = "") => (
    <div className="flex items-baseline justify-between border-b border-border/50 py-2">
      <span className="text-[10px] tracking-[0.25em] text-muted-foreground">{label}</span>
      <span className={`tabular-nums text-sm ${cls}`}>{val}</span>
    </div>
  );

  const pnlCls = pnl >= 0 ? "text-neon" : "text-destructive";

  return (
    <section className="panel rounded-lg p-4 h-[420px] flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs tracking-[0.3em] text-neon">PORTFOLIO SUMMARY</h3>
        <span className="text-[10px] tracking-widest px-2 py-1 rounded-sm border border-gold/40 text-gold bg-gold/5">
          PAPER TRADING
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
        <div className="flex flex-col">
          {stat("TOTAL DEPLOYED", <span className="text-gold">{totalDeployed.toFixed(0)} SEK</span>)}
          {stat(
            "TOTAL P&L",
            <span className={pnlCls}>
              {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} SEK ({pnl >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)
            </span>,
          )}
          {stat("ACTIVE MARKETS", String(markets.length))}
          {stat("BEST PERFORMER", best ? best.name : "—")}
          {stat("MODE", <span className="text-gold">PAPER</span>)}
        </div>
        <div className="relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius={42} outerRadius={70} paddingAngle={2} stroke="none">
                {data.map((d) => <Cell key={d.name} fill={d.color} />)}
              </Pie>
              <Tooltip
                contentStyle={{ background: "var(--terminal)", border: "1px solid var(--border)", fontSize: 11 }}
                formatter={(v: number, n) => [`${v} SEK`, n]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div className="text-[10px] tracking-widest text-muted-foreground">ALLOCATION</div>
            <div className="text-gold font-display text-lg">{totalDeployed.toFixed(0)}</div>
            <div className="text-[10px] text-muted-foreground">SEK</div>
          </div>
        </div>
      </div>
    </section>
  );
}
