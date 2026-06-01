import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TradeRow } from "@/lib/dashboard-data";

function ts(iso: string | null | undefined) {
  if (!iso) return "--:--:--";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function mapTrade(r: any, marketNames: Record<string, string>): TradeRow {
  return {
    id: r.id,
    time: ts(r.opened_at),
    market: marketNames[r.market_id] ?? r.market_id,
    asset: r.asset,
    action: r.action,
    entry: Number(r.entry_price),
    current: Number(r.exit_price ?? r.entry_price),
    pnl: Number(r.pnl_pct ?? 0),
    status: r.status,
    mode: r.mode,
  };
}

export function useTrades() {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [marketNames, setMarketNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [mRes, tRes] = await Promise.all([
        supabase.from("markets").select("id,name"),
        supabase
          .from("trades")
          .select("*")
          .order("opened_at", { ascending: false })
          .limit(20),
      ]);

      if (cancelled) return;

      const names: Record<string, string> = {};
      (mRes.data ?? []).forEach((m: any) => (names[m.id] = m.name));
      setMarketNames(names);

      if (tRes.data) setTrades(tRes.data.map((r: any) => mapTrade(r, names)));
      setLoading(false);
    }

    load().catch((e) => {
      console.error("[useTrades] load failed", e);
      if (!cancelled) setLoading(false);
    });

    const ch = supabase
      .channel("dashboard-trades")
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, (payload) => {
        const row: any = payload.new ?? payload.old;
        if (!row) return;
        setTrades((prev) => {
          if (payload.eventType === "DELETE") return prev.filter((t) => t.id !== row.id);
          const mapped = mapTrade(row, marketNames);
          const idx = prev.findIndex((t) => t.id === row.id);
          if (idx === -1) return [mapped, ...prev].slice(0, 20);
          const copy = prev.slice();
          copy[idx] = mapped;
          return copy;
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [marketNames]);

  return { trades, loading };
}
