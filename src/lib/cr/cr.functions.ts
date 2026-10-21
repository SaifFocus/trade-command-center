import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertOwner } from "@/lib/auth/owner.server";
import { CAMPAIGN_STATUSES } from "./logic";
import { campaignInput } from "./campaign-input";
import { clipReviewInput, clipReviewUpdate } from "./clip-review";
import { accountInput, agentInput } from "./management-input";

// Owner-only Content Rewards actions. Reads happen in the browser under the owner-only SELECT
// policies; every write goes through here (requireSupabaseAuth + assertOwner, then service role).
// External agents never use these: they write through the service_role-only cr_* SQL functions.

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function fail(message: string, error: { message?: string; code?: string } | null): never {
  if (error?.code === "23505") throw new Error("That one already exists.");
  throw new Error(message);
}

export const saveCampaignFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(campaignInput)
  .handler(async ({ context, data }) => {
    await assertOwner(context.supabase);
    const db = await admin();
    const { id, ...fields } = data;
    const row = { ...fields, updated_at: new Date().toISOString() };
    const res = id
      ? await db.from("cr_campaigns").update(row).eq("id", id).select("id").single()
      : await db.from("cr_campaigns").insert(row).select("id").single();
    if (res.error || !res.data) fail("Could not save the campaign.", res.error);
    return { id: res.data.id };
  });

export const setCampaignStatusFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid(), status: z.enum(CAMPAIGN_STATUSES) }))
  .handler(async ({ context, data }) => {
    await assertOwner(context.supabase);
    const db = await admin();
    const { data: updated, error } = await db
      .from("cr_campaigns")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id)
      .select("id")
      .maybeSingle();
    if (error) fail("Could not change the status.", error);
    if (!updated) throw new Error("Campaign not found.");
    return { ok: true };
  });

/** Approve or reject a clip waiting for the owner. Only moves clips that are still awaiting approval. */
export const reviewClipFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(clipReviewInput)
  .handler(async ({ context, data }) => {
    await assertOwner(context.supabase);
    const db = await admin();
    const { data: clip, error: readErr } = await db
      .from("cr_clips")
      .select("stage, qa_notes, updated_at")
      .eq("id", data.id)
      .single();
    if (readErr || !clip) fail("Clip not found.", readErr);
    const stamp = new Date().toISOString();
    const { data: updated, error } = await db
      .from("cr_clips")
      .update(clipReviewUpdate(clip.stage, clip.qa_notes, data.decision, data.note, stamp))
      .eq("id", data.id)
      .eq("stage", "awaiting_approval")
      .eq("updated_at", clip.updated_at)
      .select("id");
    if (error) fail("Could not save the decision.", error);
    if (!updated || updated.length === 0)
      throw new Error("This clip is no longer waiting for approval.");
    return { ok: true };
  });

export const saveAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(accountInput)
  .handler(async ({ context, data }) => {
    await assertOwner(context.supabase);
    const db = await admin();
    const { id, ...fields } = data;
    const row = {
      ...fields,
      handle: fields.handle.replace(/^@/, ""),
      updated_at: new Date().toISOString(),
    };
    const res = id
      ? await db.from("cr_accounts").update(row).eq("id", id).select("id").single()
      : await db.from("cr_accounts").insert(row).select("id").single();
    if (res.error || !res.data) fail("Could not save the account.", res.error);
    return { id: res.data.id };
  });

export const updateAgentFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(agentInput)
  .handler(async ({ context, data }) => {
    await assertOwner(context.supabase);
    const db = await admin();
    const patch: { enabled?: boolean; autonomy?: string } = {};
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.autonomy !== undefined) patch.autonomy = data.autonomy;
    const { data: rows, error } = await db
      .from("cr_agents")
      .update(patch)
      .eq("key", data.key)
      .select("key");
    if (error) fail("Could not update the agent.", error);
    if (!rows || rows.length === 0) throw new Error("Unknown agent.");
    return { ok: true };
  });
