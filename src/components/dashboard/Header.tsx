import { useEffect, useState } from "react";
import { Activity } from "lucide-react";

export function Header({ portfolio }: { portfolio: number }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const time = now.toISOString().substring(11, 19) + " UTC";

  return (
    <header className="panel relative overflow-hidden border-b">
      <div className="absolute inset-0 opacity-30 pointer-events-none"
        style={{ background: "radial-gradient(600px 120px at 10% 0%, color-mix(in oklab, var(--neon) 22%, transparent), transparent)" }} />
      <div className="relative mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <h1 className="text-neon font-display text-3xl font-black tracking-[0.2em] leading-none flicker">APEX</h1>
            <span className="text-[10px] tracking-[0.4em] text-muted-foreground mt-1">AUTONOMOUS TRADING SYSTEM</span>
          </div>
          <div className="hidden md:flex items-center gap-2 ml-6 px-3 py-1.5 rounded border border-border bg-terminal">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full rounded-full bg-neon opacity-60 pulse-dot" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-neon" />
            </span>
            <span className="text-xs tracking-widest text-neon">SYSTEM ONLINE</span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="text-right">
            <div className="text-[10px] tracking-[0.3em] text-muted-foreground">SYSTEM TIME</div>
            <div className="font-mono text-lg text-foreground tabular-nums">{time}</div>
          </div>
          <div className="flex items-center gap-2 rounded border border-border bg-terminal px-3 py-1.5">
            <Activity className="h-4 w-4 text-neon" />
            <span className="text-xs text-muted-foreground tracking-widest">LATENCY 12ms</span>
          </div>
          <div className="text-right border-l border-border pl-6">
            <div className="text-[10px] tracking-[0.3em] text-muted-foreground">TOTAL PORTFOLIO</div>
            <div className="text-gold font-display text-3xl font-bold tabular-nums">{portfolio.toLocaleString()} <span className="text-xl">SEK</span></div>
          </div>
        </div>
      </div>
    </header>
  );
}
