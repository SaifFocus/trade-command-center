import { createFileRoute } from "@tanstack/react-router";

// Scout daily job: leaderboard pull (once per day) + Invo ingest of missing days. Requires x-cron-secret.
export const Route = createFileRoute("/api/cron/sm-daily")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCron } = await import("@/lib/hl/cron-auth.server");
        const db = await verifyCron(request);
        if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const m = await import("@/lib/sm/candidates.server");
        try {
          const step = new URL(request.url).searchParams.get("step");
          const out: Record<string, unknown> = {};
          if (step !== "invo") out.leaderboard = await m.pullLeaderboard(db);
          if (step !== "leaderboard") out.invo = await m.ingestInvo(db);
          return Response.json(out);
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
