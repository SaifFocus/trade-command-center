import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertOwner } from "@/lib/auth/owner.server";

// Owner-only paper desk actions.
export const runCycleFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runCycle } = await import("./desk.server");
    return JSON.parse(JSON.stringify(await runCycle(supabaseAdmin))) as Record<string, string | number | string[] | null>;
  });

export const runExecuteFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runExecute } = await import("./desk.server");
    return JSON.parse(JSON.stringify(await runExecute(supabaseAdmin))) as Record<string, number | string | string[]>;
  });

export const setKillSwitchFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ on: z.boolean() }))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("desk_config").update({ kill_switch: data.on, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("agent_logs").insert({ agent_name: "PAPER DESK", message: `Kill switch turned ${data.on ? "ON" : "OFF"} by owner`, level: "WARN", market_id: "swing" });
    return { ok: true };
  });
