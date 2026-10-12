import { createFileRoute } from "@tanstack/react-router";

// Invo bridge: one round of captured Invo responses (gzip JSON when x-body-encoding: gzip). Requires x-bridge-secret.
const MAX_BYTES = 25_000_000;

export const Route = createFileRoute("/api/invo/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { verifyBridge, ingestInvoBridge } = await import("@/lib/sm/invo-bridge.server");
        const db = await verifyBridge(request);
        if (!db) return Response.json({ error: "Unauthorized" }, { status: 401 });
        if (Number(request.headers.get("content-length") ?? 0) > MAX_BYTES) return Response.json({ error: "Too large" }, { status: 413 });
        try {
          const gz = request.headers.get("x-body-encoding") === "gzip";
          const text = gz && request.body
            ? await new Response(request.body.pipeThrough(new DecompressionStream("gzip"))).text()
            : await request.text();
          if (text.length > MAX_BYTES * 4) return Response.json({ error: "Too large" }, { status: 413 });
          return Response.json(await ingestInvoBridge(db, JSON.parse(text)));
        } catch (e) {
          return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
        }
      },
    },
  },
});
