import { createFileRoute } from "@tanstack/react-router";

// Paper universe check (pg_cron every 3 min until done): backfills coins ranked 21–40 by volume, then backtests them as a
// group and adds the ones that pass to the paper desk. A no-op once finished. Requires x-cron-secret.
export const Route = createFileRoute("/api/cron/desk-universe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCron } = await import("@/lib/hl/cron-auth.server");
        const db = await verifyCron(request);
        if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const { runUniverseJob } = await import("@/lib/hl/universe.server");
        try {
          return Response.json(await runUniverseJob(db, 100_000));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
