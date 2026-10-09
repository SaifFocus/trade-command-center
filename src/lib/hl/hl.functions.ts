import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

// Public endpoints: they only read Hyperliquid's public API and write derived market data.
export const syncUniverseFn = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { syncUniverse } = await import("./sync.server");
  return { coins: await syncUniverse(supabaseAdmin) };
});

export const syncCoinFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ coin: z.string().min(1).max(20) }))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncCoin } = await import("./sync.server");
    return syncCoin(supabaseAdmin, data.coin);
  });

export const runBacktestFn = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { runAndStore, loadCoinData, CONFIGS } = await import("./backtest.server");
  const data = await loadCoinData(supabaseAdmin);
  const out = [];
  for (const cfg of CONFIGS) out.push(await runAndStore(supabaseAdmin, cfg, data));
  return out.map((r) => r.id);
});
