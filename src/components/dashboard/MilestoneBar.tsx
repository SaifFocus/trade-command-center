import { Check } from "lucide-react";
import type { MilestoneRow } from "@/lib/dashboard-data";

export function MilestoneBar({ value, milestones }: { value: number; milestones: MilestoneRow[] }) {
  const goal = milestones.length > 0 ? milestones[milestones.length - 1].value : 1_000_000;
  const pct = Math.min(100, (value / goal) * 100);
  const next = milestones.find((m) => m.value > value) ?? milestones[milestones.length - 1];
  const nextPct = next ? (next.value / goal) * 100 : 100;

  return (
    <section className="panel mx-auto max-w-[1600px] mt-4 rounded-lg p-5">
      <div className="flex items-center justify-between text-xs tracking-widest mb-3">
        <div className="text-muted-foreground">MISSION: <span className="text-gold">850 → {goal.toLocaleString()} SEK</span></div>
        <div className="text-muted-foreground">NEXT GOAL: <span className="text-gold">{next ? next.value.toLocaleString() : "—"} SEK</span> · <span className="text-neon">{pct.toFixed(4)}%</span></div>
      </div>
      <div className="relative h-4 rounded-full bg-terminal border border-border overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 glow-gold rounded-full"
          style={{
            width: `${Math.max(0.5, pct)}%`,
            background: "linear-gradient(90deg, color-mix(in oklab, var(--gold) 70%, transparent), var(--gold))",
          }}
        />
        {next && (
          <div
            className="absolute inset-y-0 w-0.5 bg-neon/70"
            style={{ left: `${nextPct}%` }}
          />
        )}
        {milestones.map((m) => (
          <div key={m.id}
            className="absolute top-1/2 -translate-y-1/2 h-2 w-px bg-border"
            style={{ left: `${(m.value / goal) * 100}%` }}
          />
        ))}
      </div>
      <div className="relative mt-2 h-4 text-[10px] tracking-widest text-muted-foreground">
        {milestones.map((m) => (
          <span key={m.id}
            className={`absolute -translate-x-1/2 inline-flex items-center gap-1 ${m.reached_at ? "text-gold" : ""}`}
            style={{ left: `${(m.value / goal) * 100}%` }}
          >
            {m.reached_at && <Check className="h-3 w-3" />}
            {m.label}
          </span>
        ))}
      </div>
    </section>
  );
}
