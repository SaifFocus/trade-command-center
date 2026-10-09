import { createFileRoute } from "@tanstack/react-router";

// Paper desk cycle (pg_cron "desk-cycle", minute 5 every 4h). Requires x-cron-secret.
export const Route = createFileRoute("/api/cron/desk-cycle")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCron } = await import("@/lib/hl/cron-auth.server");
        const db = await verifyCron(request);
        if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const { runCycle } = await import("@/lib/hl/desk.server");
        try {
          return Response.json(await runCycle(db));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
