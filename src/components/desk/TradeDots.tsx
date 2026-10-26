import { classify, type GridTrade, type Unit, type Outcome } from "@/lib/desk/trade-grid";

// Dot strip shared by the Desk TRADE GRID and the FX desk.
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
export const fmtRes = (v: number, u: Unit) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}${u}`;

export function Dots({ trades, unit, clusters, empties = 0 }: { trades: GridTrade[]; unit: Unit; clusters: Map<string, number>; empties?: number }) {
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

