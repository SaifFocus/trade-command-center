import { createFileRoute } from "@tanstack/react-router";

// Scout live tracking (every 5 min): watchlist positions -> events -> follow signals/exits. Requires x-cron-secret.
export const Route = createFileRoute("/api/cron/sm-track")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCron } = await import("@/lib/hl/cron-auth.server");
        const db = await verifyCron(request);
        if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const { trackWatchlist } = await import("@/lib/sm/track.server");
        try {
          return Response.json(await trackWatchlist(db));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
