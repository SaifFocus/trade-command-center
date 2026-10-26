import { createFileRoute } from "@tanstack/react-router";

// FX paper desk engine (every 5 minutes): quotes, candles, stops/targets/liquidations, funding, equity. Requires x-cron-secret.
export const Route = createFileRoute("/api/cron/fx-tick")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCron } = await import("@/lib/hl/cron-auth.server");
        const db = await verifyCron(request);
        if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const { recordRun } = await import("@/lib/agents/runs.server");
        const { fxTick } = await import("@/lib/fx/fx.server");
        try {
          return Response.json(await recordRun(db, "fx_engine", () => fxTick(db)));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
