import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertOwner } from "@/lib/auth/owner.server";
import { ACCOUNT_STATUSES, AUTONOMY, CAMPAIGN_STATUSES, PLATFORMS } from "./logic";

// Owner-only Content Rewards actions. Reads happen in the browser under the owner-only SELECT
// policies; every write goes through here (requireSupabaseAuth + assertOwner, then service role).
// External agents never use these: they write through the service_role-only cr_* SQL functions.

const money = z.number().min(0).max(100_000_000).nullable().optional();
const seconds = z.number().int().min(0).max(36_000).nullable().optional();
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const list = (max: number) => z.array(z.string().trim().min(1).max(500)).max(max).optional();

const campaignInput = z.object({
  id: z.string().uuid().optional(),
  whop_url: z.string().trim().url().max(500),
  brand: text(120),
  title: text(200),
  category: z.enum(["clipping", "ugc", "other"]).optional(),
  rate_per_1k_usd: money,
  budget_total_usd: money,
  budget_remaining_usd: money,
  min_payout_usd: money,
  max_payout_usd: money,
  flat_fee_usd: money,
  platforms: z.array(z.enum(PLATFORMS)).max(5).optional(),
  min_length_s: seconds,
  max_length_s: seconds,
  required_hashtags: list(30),
  required_credit: text(200),
  disclosure_required: z.boolean().optional(),
  prohibited: text(2000),
  source_assets: list(50),
  deadline: z.string().datetime({ offset: true }).nullable().optional(),
  score: z.number().int().min(1).max(5).nullable().optional(),
  status: z.enum(CAMPAIGN_STATUSES).optional(),
  notes: text(4000),
});

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
    const { error } = await db
      .from("cr_campaigns")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) fail("Could not change the status.", error);
    return { ok: true };
  });

/** Approve or reject a clip waiting for the owner. Only moves clips that are still awaiting approval. */
export const reviewClipFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z
      .object({
        id: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
        note: z.string().trim().max(2000).optional(),
      })
      .refine((v) => v.decision === "approve" || (v.note ?? "").length > 0, {
        message: "Add a note so the agents know why it was rejected.",
      }),
  )
  .handler(async ({ context, data }) => {
    await assertOwner(context.supabase);
    const db = await admin();
    const { data: clip, error: readErr } = await db
      .from("cr_clips")
      .select("stage, qa_notes")
      .eq("id", data.id)
      .single();
    if (readErr || !clip) fail("Clip not found.", readErr);
    if (clip.stage !== "awaiting_approval")
      throw new Error("This clip is no longer waiting for approval.");
    const stamp = new Date().toISOString();
    const line = `[${stamp.slice(0, 16).replace("T", " ")} owner ${data.decision === "approve" ? "approved" : "rejected"}]${data.note ? ` ${data.note}` : ""}`;
    const { data: updated, error } = await db
      .from("cr_clips")
      .update({
        stage: data.decision === "approve" ? "approved" : "denied",
        qa_notes: clip.qa_notes ? `${clip.qa_notes}\n${line}` : line,
        updated_at: stamp,
      })
      .eq("id", data.id)
      .eq("stage", "awaiting_approval")
      .select("id");
    if (error) fail("Could not save the decision.", error);
    if (!updated || updated.length === 0)
      throw new Error("This clip is no longer waiting for approval.");
    return { ok: true };
  });

export const saveAccountFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      id: z.string().uuid().optional(),
      platform: z.enum(PLATFORMS),
      handle: z.string().trim().min(1).max(100),
      linked_in_whop: z.boolean(),
      status: z.enum(ACCOUNT_STATUSES),
      notes: text(1000),
    }),
  )
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
  .inputValidator(
    z
      .object({
        key: z.string().min(1).max(60),
        enabled: z.boolean().optional(),
        autonomy: z.enum(AUTONOMY).optional(),
      })
      .refine((v) => v.enabled !== undefined || v.autonomy !== undefined, {
        message: "Nothing to change.",
      }),
  )
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
