import { createFileRoute } from "@tanstack/react-router";

// Copy backtest (pg_cron): ?step=sync keeps hourly candles fresh for the coins graded wallets trade (every 15 min);
// ?step=run runs the walk-forward copy backtest and stores it in backtest_runs (daily). Requires x-cron-secret.
export const Route = createFileRoute("/api/cron/sm-copy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCron } = await import("@/lib/hl/cron-auth.server");
        const db = await verifyCron(request);
        if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const m = await import("@/lib/sm/copy.server");
        try {
          const step = new URL(request.url).searchParams.get("step");
          if (step === "run") return Response.json(await m.runCopy(db));
          return Response.json(await m.syncCopyData(db));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
