import { createFileRoute } from "@tanstack/react-router";

// Copy backtest (pg_cron): ?step=sync keeps hourly candles fresh for the coins graded wallets trade (hourly);
// ?step=run runs the walk-forward copy backtest and stores it in backtest_runs (daily). Requires x-cron-secret.
export const Route = createFileRoute("/api/cron/sm-copy")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyCron } = await import("@/lib/hl/cron-auth.server");
        const db = await verifyCron(request);
        if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
        const { recordRun } = await import("@/lib/agents/runs.server");
        const m = await import("@/lib/sm/copy.server");
        try {
          const step = new URL(request.url).searchParams.get("step");
          if (step === "run") return Response.json(await recordRun(db, "copy_backtest", () => m.runCopy(db)));
          return Response.json(await recordRun(db, "copy_sync", () => m.syncCopyData(db)));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
