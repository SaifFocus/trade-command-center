import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";
import type { LogEntry } from "@/lib/dashboard-data";

export function ActivityLog({ logs }: { logs: LogEntry[] }) {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" });
  }, [logs]);

  const now = new Date();
  const nowTs = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  return (
    <section className="panel rounded-lg overflow-hidden flex flex-col h-[420px]">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-terminal/80">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-neon" />
          <h2 className="text-xs tracking-[0.3em] text-neon">AGENT ACTIVITY LOG</h2>
        </div>
        <div className="flex gap-1.5">
          <span className="h-2 w-2 rounded-full bg-destructive/70" />
          <span className="h-2 w-2 rounded-full bg-gold/70" />
          <span className="h-2 w-2 rounded-full bg-neon/70 pulse-dot" />
        </div>
      </div>
      <div ref={boxRef} className="flex-1 overflow-y-auto bg-terminal p-3 font-mono text-[12px] leading-relaxed scanline relative">
        {logs.length === 0 && (
          <div className="text-muted-foreground">[--:--:--] Waiting for agent activity…</div>
        )}
        {logs.map((l) => {
          const cls =
            l.level === "ERROR" ? "text-destructive" :
            l.level === "WARN"  ? "text-gold" :
            "text-neon/90";
          return (
            <div key={l.id} className={cls}>
              <span className="text-muted-foreground">[{l.t}]</span>{" "}
              <span className="text-muted-foreground/70">{l.agent} —</span> {l.message}
            </div>
          );
        })}
        <div className="text-neon">
          <span className="text-muted-foreground">[{nowTs}]</span>{" "}
          <span className="inline-block w-2 h-3.5 bg-neon align-middle pulse-dot" />
        </div>
      </div>
    </section>
  );
}
