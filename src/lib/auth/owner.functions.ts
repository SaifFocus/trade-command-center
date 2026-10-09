import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Public: only reveals whether an owner has been claimed (controls sign-up visibility). */
export const ownerExistsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { count } = await supabaseAdmin.from("app_owner").select("id", { count: "exact", head: true });
  return { ownerExists: (count ?? 0) > 0 };
});

async function eligibility(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const ownerEmail = (process.env["OWNER_EMAIL"] ?? "").trim().toLowerCase();
  const { count } = await supabaseAdmin.from("app_owner").select("id", { count: "exact", head: true });
  const ownerExists = (count ?? 0) > 0;
  const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
  const u = data?.user;
  const email = (u?.email ?? "").toLowerCase();
  const providers: string[] = (u?.app_metadata?.providers as string[]) ?? [u?.app_metadata?.provider as string];
  const verified = !!u?.email_confirmed_at || providers.includes("google");
  const canClaim = !ownerExists && !!ownerEmail && email === ownerEmail && verified;
  return { supabaseAdmin, ownerExists, canClaim };
}

export const ownerStatusFn = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isOwner } = await context.supabase.rpc("is_owner");
    if (isOwner === true) return { isOwner: true, canClaim: false };
    const { canClaim } = await eligibility(context.userId);
    return { isOwner: false, canClaim };
  });

export const claimOwnerFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin, canClaim } = await eligibility(context.userId);
    if (!canClaim) throw new Error("Not authorized");
    const { error } = await supabaseAdmin.from("app_owner").insert({ id: 1, user_id: context.userId });
    if (error) throw new Error("Not authorized");
    return { ok: true };
  });
