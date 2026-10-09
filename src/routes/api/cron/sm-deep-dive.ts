import { createFileRoute } from "@tanstack/react-router";

// Scout deep-dive queue (every 5 min, ~120s budget so runs never overlap). Requires x-cron-secret.
export const Route = createFileRoute("/api/cron/sm-deep-dive")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCron } = await import("@/lib/hl/cron-auth.server");
        const db = await verifyCron(request);
        if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const { processQueue } = await import("@/lib/sm/deep.server");
        try {
          return Response.json(await processQueue(db, 120_000));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
