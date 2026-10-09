/** Verifies x-cron-secret against the service-role-only DB check. Returns the admin client or null. */
export async function verifyCron(request: Request) {
  const token = request.headers.get("x-cron-secret");
  if (!token || token.length < 32 || token.length > 256) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: ok } = await supabaseAdmin.rpc("verify_cron_secret", { p_token: token });
  return ok === true ? supabaseAdmin : null;
}
