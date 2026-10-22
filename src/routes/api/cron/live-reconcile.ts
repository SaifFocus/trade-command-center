import { createFileRoute } from "@tanstack/react-router";

// Live desk reconcile (pg_cron "live-reconcile": every 2 minutes while live is armed or the kill switch is on, else every 10). Requires x-cron-secret.
// Does nothing unless live trading is configured and armed, a live position is open, or the kill switch is on.
export const Route = createFileRoute("/api/cron/live-reconcile")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCron } = await import("@/lib/hl/cron-auth.server");
        const db = await verifyCron(request);
        if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const { recordRun } = await import("@/lib/agents/runs.server");
        const { reconcileLive } = await import("@/lib/live/live.server");
        try {
          return Response.json(await recordRun(db, "live_watchdog", () => reconcileLive(db)));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
