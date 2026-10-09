import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertOwner } from "@/lib/auth/owner.server";

// Owner-only scout actions for the /scout page.
export const runCopyBacktestFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runCopy } = await import("./copy.server");
    return { summary: JSON.stringify(await runCopy(supabaseAdmin)) };
  });

export const syncCopyDataFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { syncCopyData } = await import("./copy.server");
    return { summary: JSON.stringify(await syncCopyData(supabaseAdmin)) };
  });
