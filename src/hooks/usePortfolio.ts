import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  MARKET_DEFAULTS,
  MILESTONES as STATIC_MILESTONES,
  type Market,
  type LogEntry,
  type MilestoneRow,
} from "@/lib/dashboard-data";

export type Snapshot = { t: string; v: number };

function mapMarket(row: any, snapshots: Snapshot[]): Market {
  const id = row.id as string;
  const def = MARKET_DEFAULTS[id] ?? { color: "#888", emoji: "•" };
  const seed = Number(row.seed_sek ?? 0);
  const current = Number(row.current_sek ?? seed);
  const spark =
    snapshots.length > 0
      ? snapshots.map((s) => ({ v: s.v }))
      : Array.from({ length: 24 }, () => ({ v: current }));
  return {
    id,
    name: row.name ?? id.toUpperCase(),
    emoji: row.emoji ?? def.emoji,
    color: row.color ?? def.color,
    seed,
    current,
    status: row.status ?? "SCANNING",
    lastSignal: row.last_signal ?? "Awaiting first signal...",
    spark,
  };
}

function ts(iso: string | null | undefined) {
  if (!iso) return "--:--:--";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

export function usePortfolio() {
  const [marketsRaw, setMarketsRaw] = useState<any[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [milestones, setMilestones] = useState<MilestoneRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [mRes, sRes, lRes, msRes] = await Promise.all([
        supabase.from("markets").select("*"),
        supabase
          .from("portfolio_snapshots")
          .select("snapshot_at,total_sek")
          .order("snapshot_at", { ascending: false })
          .limit(48),
        supabase
          .from("agent_logs")
          .select("id,created_at,message,agent_name,level,market_id")
          .order("created_at", { ascending: false })
          .limit(20),
        supabase
          .from("milestones")
          .select("id,label,target_sek,reached_at")
          .order("target_sek", { ascending: true }),
      ]);

      if (cancelled) return;

      if (mRes.data) setMarketsRaw(mRes.data);
      if (sRes.data) {
        setSnapshots(
          sRes.data
            .slice()
            .reverse()
            .map((r: any) => ({ t: r.snapshot_at, v: Number(r.total_sek) })),
        );
      }
      if (lRes.data) {
        setLogs(
          lRes.data
            .slice()
            .reverse()
            .map((r: any) => ({
              id: r.id,
              t: ts(r.created_at),
              message: r.message,
              agent: r.agent_name,
              level: r.level,
              market_id: r.market_id,
            })),
        );
      }
      if (msRes.data) {
        setMilestones(
          msRes.data.map((r: any) => ({
            id: r.id,
            label: r.label,
            value: Number(r.target_sek),
            reached_at: r.reached_at,
          })),
        );
      }
      setLoading(false);
    }

    load().catch((e) => {
      console.error("[usePortfolio] load failed", e);
      if (!cancelled) setLoading(false);
    });

    const ch = supabase
      .channel("dashboard-portfolio")
      .on("postgres_changes", { event: "*", schema: "public", table: "markets" }, (payload) => {
        setMarketsRaw((prev) => {
          const row: any = payload.new ?? payload.old;
          if (!row) return prev;
          if (payload.eventType === "DELETE") return prev.filter((r) => r.id !== row.id);
          const idx = prev.findIndex((r) => r.id === row.id);
          if (idx === -1) return [...prev, row];
          const copy = prev.slice();
          copy[idx] = { ...copy[idx], ...row };
          return copy;
        });
      })
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "portfolio_snapshots" },
        (payload) => {
          const r: any = payload.new;
          setSnapshots((prev) =>
            [...prev, { t: r.snapshot_at, v: Number(r.total_sek) }].slice(-48),
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "agent_logs" },
        (payload) => {
          const r: any = payload.new;
          setLogs((prev) =>
            [
              ...prev,
              {
                id: r.id,
                t: ts(r.created_at),
                message: r.message,
                agent: r.agent_name,
                level: r.level,
                market_id: r.market_id,
              },
            ].slice(-50),
          );
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "milestones" }, (payload) => {
        const r: any = payload.new ?? payload.old;
        if (!r) return;
        setMilestones((prev) => {
          if (payload.eventType === "DELETE") return prev.filter((m) => m.id !== r.id);
          const mapped: MilestoneRow = {
            id: r.id,
            label: r.label,
            value: Number(r.target_sek),
            reached_at: r.reached_at,
          };
          const idx = prev.findIndex((m) => m.id === r.id);
          const next = idx === -1 ? [...prev, mapped] : prev.map((m, i) => (i === idx ? mapped : m));
          return next.sort((a, b) => a.value - b.value);
        });
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, []);

  const markets: Market[] = marketsRaw.map((row) => mapMarket(row, snapshots));
  const totalSek = markets.reduce((a, m) => a + m.current, 0);
  const effectiveMilestones =
    milestones.length > 0
      ? milestones
      : STATIC_MILESTONES.map((m, i) => ({ id: i, label: m.label, value: m.value, reached_at: null }));

  return { markets, snapshots, logs, milestones: effectiveMilestones, totalSek, loading };
}
