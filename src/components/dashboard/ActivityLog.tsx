import { useEffect, useRef, useState } from "react";
import { SEED_LOG_LINES } from "@/lib/dashboard-data";
import { Terminal } from "lucide-react";

function ts() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`;
}

const POOL = [
  ...SEED_LOG_LINES,
  "📊 Scanner — 132 candles processed (eth-sek-1m)",
  "🧮 Strategy — RSI(14)=42.1, MACD bearish cross detected",
  "🛡️ Risk Agent — Position size approved: 0.4% NAV",
  "🤖 Orchestrator — Heartbeat ok · 6/6 agents healthy",
  "🔔 Alert — Sentiment spike on $SOL — confidence 0.71",
  "🧠 LLM — Context window 14k/32k · cost €0.0021",
];

export function ActivityLog() {
  const [lines, setLines] = useState<{ t: string; msg: string }[]>(() =>
    SEED_LOG_LINES.slice(0, 4).map((msg) => ({ t: ts(), msg }))
  );
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = setInterval(() => {
      setLines((prev) => {
        const msg = POOL[Math.floor(Math.random() * POOL.length)];
        const next = [...prev, { t: ts(), msg }];
        return next.slice(-80);
      });
    }, 2200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  return (
    <section className="panel rounded-lg overflow-hidden flex flex-col h-[420px]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-terminal/80">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-neon" />
          <h3 className="text-xs tracking-[0.3em] text-neon">AGENT ACTIVITY LOG</h3>
        </div>
        <div className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-destructive/70" />
          <span className="h-2 w-2 rounded-full bg-gold/70" />
          <span className="h-2 w-2 rounded-full bg-neon/70 pulse-dot" />
        </div>
      </div>
      <div ref={boxRef} className="flex-1 overflow-y-auto bg-terminal p-3 font-mono text-[12px] leading-relaxed scanline relative">
        {lines.map((l, i) => (
          <div key={i} className="text-neon/90">
            <span className="text-muted-foreground">[{l.t}]</span> {l.msg}
          </div>
        ))}
        <div className="text-neon">
          <span className="text-muted-foreground">[{ts()}]</span> <span className="inline-block w-2 h-3.5 bg-neon align-middle pulse-dot" />
        </div>
      </div>
    </section>
  );
}
