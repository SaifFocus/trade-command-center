import { createFileRoute } from "@tanstack/react-router";

// Incremental Hyperliquid sync, called by pg_cron job "hl-sync-4h".
// Requires header x-cron-secret matching the server-side token (verified by a service-role-only DB function).
export const Route = createFileRoute("/api/cron/hl-sync")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("x-cron-secret");
        const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });
        if (!token || token.length < 32 || token.length > 256) return unauthorized();
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: ok } = await supabaseAdmin.rpc("verify_cron_secret", { p_token: token });
        if (ok !== true) return unauthorized();

        const { data: last } = await supabaseAdmin
          .from("hl_universe").select("snapshot_at").order("snapshot_at", { ascending: false }).limit(1);
        const lastT = last?.[0]?.snapshot_at ? new Date(last[0].snapshot_at).getTime() : 0;
        if (Date.now() - lastT < 30 * 60_000) return Response.json({ skipped: "synced recently" });
        const { syncAll } = await import("@/lib/hl/sync.server");
        try {
          const r = await syncAll(supabaseAdmin);
          return Response.json({ coins: r.coins.length });
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
