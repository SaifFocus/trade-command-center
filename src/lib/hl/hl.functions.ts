import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertOwner } from "@/lib/auth/owner.server";

// Owner-only: every call is re-checked on the server before any service-role work.
export const syncUniverseFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncUniverse } = await import("./sync.server");
    return { coins: await syncUniverse(supabaseAdmin) };
  });

export const syncCoinFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ coin: z.string().min(1).max(20) }))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncCoin } = await import("./sync.server");
    return syncCoin(supabaseAdmin, data.coin);
  });

export const runBacktestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runAndStore, loadCoinData, CONFIGS } = await import("./backtest.server");
    const { deskUniverse } = await import("./universe.server");
    const data = await loadCoinData(supabaseAdmin, await deskUniverse(supabaseAdmin));
    const out = [];
    for (const cfg of CONFIGS) out.push(await runAndStore(supabaseAdmin, cfg, data));
    return out.map((r) => r.id);
  });
