import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/** Throws a generic error unless the caller (RLS-scoped client) is the owner. */
export async function assertOwner(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.rpc("is_owner");
  if (error || data !== true) throw new Error("Not authorized");
}
