import { LineChart, Line, ResponsiveContainer } from "recharts";
import type { Market } from "@/lib/dashboard-data";

export function MarketCard({ m }: { m: Market }) {
  const pnl = m.current - m.seed;
  const pnlPct = (pnl / m.seed) * 100;
  const isPaper = m.status === "PAPER TRADING";

  return (
    <div
      className="panel relative overflow-hidden rounded-lg p-4 transition-transform hover:-translate-y-0.5"
      style={{
        borderColor: `color-mix(in oklab, ${m.color} 50%, var(--border))`,
        boxShadow: `0 0 24px color-mix(in oklab, ${m.color} 12%, transparent), inset 0 0 0 1px color-mix(in oklab, ${m.color} 20%, transparent)`,
      }}
    >
      <div
        className="absolute -top-10 -right-10 h-32 w-32 rounded-full opacity-20 blur-2xl pointer-events-none"
        style={{ background: m.color }}
      />

      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">{m.emoji}</span>
            <h3 className="text-sm font-bold tracking-widest" style={{ color: m.color }}>{m.name}</h3>
          </div>
          <div className="mt-1 text-[10px] tracking-widest text-muted-foreground">SEED · {m.seed} SEK</div>
        </div>
        <span
          className="inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[10px] tracking-widest"
          style={{
            color: isPaper ? "#00D4FF" : "#FFFF00",
            borderColor: isPaper ? "#00D4FF55" : "#FFFF0055",
            background: isPaper ? "#00D4FF11" : "#FFFF0011",
          }}
        >
          <span className="h-1.5 w-1.5 rounded-full pulse-dot" style={{ background: isPaper ? "#00D4FF" : "#FFFF00" }} />
          {m.status}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="text-[10px] tracking-widest text-muted-foreground">CURRENT</div>
          <div className="font-display text-2xl tabular-nums text-foreground">{m.current.toFixed(2)} <span className="text-xs text-muted-foreground">SEK</span></div>
        </div>
        <div className="text-right">
          <div className="text-[10px] tracking-widest text-muted-foreground">P&amp;L</div>
          <div className={`tabular-nums ${pnl >= 0 ? "text-neon" : "text-destructive"}`}>
            {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)} SEK
          </div>
          <div className={`text-xs tabular-nums ${pnl >= 0 ? "text-neon" : "text-destructive"}`}>
            {pnl >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%
          </div>
        </div>
      </div>

      <div className="mt-3 h-12">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={m.spark}>
            <Line type="monotone" dataKey="v" stroke={m.color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 border-t border-border/60 pt-2 text-[11px] text-muted-foreground truncate">
        <span className="text-muted-foreground/70">LAST SIGNAL · </span>{m.lastSignal}
      </div>
    </div>
  );
}
