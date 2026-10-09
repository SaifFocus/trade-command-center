import { createFileRoute } from "@tanstack/react-router";

// Paper desk execute pass (pg_cron "desk-execute", minute 50 every 4h). Requires x-cron-secret.
export const Route = createFileRoute("/api/cron/desk-execute")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCron } = await import("@/lib/hl/cron-auth.server");
        const db = await verifyCron(request);
        if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const { runExecute } = await import("@/lib/hl/desk.server");
        try {
          return Response.json(await runExecute(db));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
