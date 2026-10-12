import { createFileRoute } from "@tanstack/react-router";

// Invo bridge: which Invo portfolios to open and what to forward. Requires x-bridge-secret (see invo-bridge.server.ts).
export const Route = createFileRoute("/api/invo/targets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { verifyBridge, bridgeTargets } = await import("@/lib/sm/invo-bridge.server");
        const db = await verifyBridge(request);
        if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
        return Response.json(await bridgeTargets(db));
      },
    },
  },
});
