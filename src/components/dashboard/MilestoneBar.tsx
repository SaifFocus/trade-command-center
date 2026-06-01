import { MILESTONES } from "@/lib/dashboard-data";

export function MilestoneBar({ value }: { value: number }) {
  const goal = 1_000_000;
  const pct = Math.min(100, (value / goal) * 100);
  const next = MILESTONES.find((m) => m.value > value) ?? MILESTONES[MILESTONES.length - 1];
  const nextPct = (next.value / goal) * 100;

  return (
    <section className="panel mx-auto max-w-[1600px] mt-4 rounded-lg p-5">
      <div className="flex items-center justify-between text-xs tracking-widest mb-3">
        <div className="text-muted-foreground">MISSION: <span className="text-gold">850 → 1,000,000 SEK</span></div>
        <div className="text-muted-foreground">NEXT GOAL: <span className="text-gold">{next.value.toLocaleString()} SEK</span> · <span className="text-neon">{pct.toFixed(4)}%</span></div>
      </div>
      <div className="relative h-4 rounded-full bg-terminal border border-border overflow-hidden">
        <div
          className="absolute inset-y-0 left-0 glow-gold rounded-full"
          style={{
            width: `${Math.max(0.5, pct)}%`,
            background: "linear-gradient(90deg, color-mix(in oklab, var(--gold) 70%, transparent), var(--gold))",
          }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-neon/70"
          style={{ left: `${nextPct}%` }}
        />
        {MILESTONES.map((m) => (
          <div key={m.label}
            className="absolute top-1/2 -translate-y-1/2 h-2 w-px bg-border"
            style={{ left: `${(m.value / goal) * 100}%` }}
          />
        ))}
      </div>
      <div className="relative mt-2 h-4 text-[10px] tracking-widest text-muted-foreground">
        {MILESTONES.map((m) => (
          <span key={m.label}
            className="absolute -translate-x-1/2"
            style={{ left: `${(m.value / goal) * 100}%` }}
          >{m.label}</span>
        ))}
      </div>
    </section>
  );
}
