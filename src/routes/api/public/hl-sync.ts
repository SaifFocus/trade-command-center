import { createFileRoute } from "@tanstack/react-router";

// Incremental Hyperliquid sync, hit by pg_cron every 4h. Public data only; self-throttled
// so repeated external calls can't hammer Hyperliquid (skips if synced < 30 min ago).
export const Route = createFileRoute("/api/public/hl-sync")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: last } = await supabaseAdmin
          .from("hl_universe").select("snapshot_at").order("snapshot_at", { ascending: false }).limit(1);
        const lastT = last?.[0]?.snapshot_at ? new Date(last[0].snapshot_at).getTime() : 0;
        if (Date.now() - lastT < 30 * 60_000) return Response.json({ skipped: "synced recently" });
        const { syncAll } = await import("@/lib/hl/sync.server");
        try {
          return Response.json(await syncAll(supabaseAdmin));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
