import { MOCK_TRADES } from "@/lib/dashboard-data";

export function TradesTable() {
  return (
    <section className="panel rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-terminal/60">
        <h3 className="text-xs tracking-[0.3em] text-neon">RECENT TRADES</h3>
        <span className="text-[10px] tracking-widest text-muted-foreground">No live trades yet — system in paper trading mode</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] tracking-[0.25em] text-muted-foreground bg-terminal/40">
              {["TIME","MARKET","ASSET","ACTION","ENTRY","CURRENT","P&L","STATUS"].map(h => (
                <th key={h} className="px-4 py-2.5 text-left font-normal">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_TRADES.map((t, i) => {
              const pnlPos = t.pnl >= 0;
              return (
                <tr key={i} className="border-t border-border/40 hover:bg-accent/20">
                  <td className="px-4 py-3 font-mono text-muted-foreground">{t.time}</td>
                  <td className="px-4 py-3">{t.market}</td>
                  <td className="px-4 py-3 text-foreground font-bold">{t.asset}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-sm text-xs tracking-widest border ${t.action === "BUY" ? "text-neon border-neon/40 bg-neon/5" : "text-destructive border-destructive/40 bg-destructive/5"}`}>
                      {t.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums">{t.entry.toLocaleString()}</td>
                  <td className="px-4 py-3 tabular-nums">{t.current.toLocaleString()}</td>
                  <td className={`px-4 py-3 tabular-nums ${pnlPos ? "text-neon" : "text-destructive"}`}>
                    {pnlPos ? "+" : ""}{t.pnl.toFixed(2)}%
                  </td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-sm text-[10px] tracking-widest border border-gold/40 text-gold bg-gold/5">PAPER</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
