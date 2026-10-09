import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { invoTicket, type TicketSignal } from "@/lib/live/extras";

// Ready-to-copy tickets for placing APEX's approved trades by hand in Invo (separate money from APEX's budget).
const KEY = "apex.invoBudgetSek";
function readBudget() {
  try { return Number(localStorage.getItem(KEY)) || 1000; } catch { return 1000; }
}

export function InvoTickets({ usdSek }: { usdSek: number | null }) {
  const [sigs, setSigs] = useState<TicketSignal[]>([]);
  const [budget, setBudget] = useState<number>(1000);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    setBudget(readBudget());
    const load = async () => {
      const { data } = await supabase.from("signals").select("coin,side,setup,ref_px,stop_px,t1_px,t2_px,status,created_at")
        .in("status", ["approved", "executed"]).gte("created_at", new Date(Date.now() - 48 * 3600_000).toISOString())
        .order("created_at", { ascending: false }).limit(6);
      setSigs((data ?? []) as TicketSignal[]);
    };
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, []);
  const save = (v: number) => { setBudget(v); try { localStorage.setItem(KEY, String(v)); } catch { /* per-browser convenience only */ } };

  return (
    <section className="panel rounded-lg p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs tracking-[0.3em] text-neon">INVO MIRROR TICKETS</h2>
        <label className="text-xs text-muted-foreground">Invo budget (SEK){" "}
          <input type="number" min={100} step={100} value={budget} onChange={(e) => save(Number(e.target.value) || 0)}
            className="w-24 rounded border border-border bg-terminal px-2 py-1 font-mono text-xs" />
        </label>
      </div>
      {!usdSek ? <div className="text-xs text-muted-foreground">Waiting for the USD/SEK rate.</div>
        : sigs.length === 0 ? <div className="text-xs text-muted-foreground">No approved trades in the last 48 hours.</div>
        : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {sigs.map((s) => {
              const t = invoTicket(s, budget, usdSek);
              const key = `${s.created_at}-${s.coin}`;
              return (
                <div key={key} className={`rounded border p-3 ${t.fits ? "border-border" : "border-destructive/60"}`}>
                  <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{t.text}</pre>
                  <button onClick={async () => { try { await navigator.clipboard.writeText(t.text); setCopied(key); } catch { setCopied(null); } }}
                    className="mt-2 rounded border border-border px-2 py-1 text-[11px] tracking-widest text-muted-foreground hover:text-neon">
                    {copied === key ? "COPIED" : "COPY"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      <div className="mt-2 text-[11px] text-muted-foreground">Placed by you in the Invo app. APEX never touches Invo (its terms ban bots). Set the stop yourself: Mimic does not copy it.</div>
    </section>
  );
}
