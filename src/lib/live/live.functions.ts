import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertOwner } from "@/lib/auth/owner.server";

// Owner-only live-desk actions. Every handler checks the owner before any service-role work.
const plain = <T,>(x: T) => JSON.parse(JSON.stringify(x)) as T;

export const liveStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { liveStatus } = await import("./live.server");
    return plain(await liveStatus(supabaseAdmin));
  });

export const smokeTestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { smokeTest } = await import("./live.server");
    return plain(await smokeTest(supabaseAdmin));
  });

export const armLiveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ phrase: z.string().max(20) }))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { armLive } = await import("./live.server");
    return plain(await armLive(supabaseAdmin, data.phrase));
  });

export const disarmLiveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { disarmLive } = await import("./live.server");
    return plain(await disarmLive(supabaseAdmin));
  });

export const killLiveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { killLive } = await import("./live.server");
    return plain(await killLive(supabaseAdmin, "KILL pressed by owner"));
  });

export const reconcileLiveFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { reconcileLive } = await import("./live.server");
    return { summary: JSON.stringify(await reconcileLive(supabaseAdmin)) };
  });

export const taxExportFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ year: z.number().int().min(2025).max(2100) }))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { taxRows, taxCsv, k4Summary } = await import("./extras");
    const { data: rows, error } = await supabaseAdmin.from("live_positions" as never).select("*").eq("status", "closed");
    if (error) throw new Error(error.message);
    const tr = taxRows((rows ?? []) as never[], data.year);
    return { csv: taxCsv(tr), summary: k4Summary(tr) };
  });
