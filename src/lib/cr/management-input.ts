import { z } from "zod";
import { ACCOUNT_STATUSES, AUTONOMY, PLATFORMS } from "./logic";

export const accountInput = z.object({
  id: z.string().uuid().optional(),
  platform: z.enum(PLATFORMS),
  handle: z.string().trim().transform((v) => v.replace(/^@+/, ""))
    .pipe(z.string().min(1, "Add the account handle.").max(100).regex(/^[^\s/@]+$/, "Enter a handle, not a profile URL.")),
  linked_in_whop: z.boolean(),
  status: z.enum(ACCOUNT_STATUSES),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const agentInput = z.object({
  key: z.string().trim().min(1).max(60),
  enabled: z.boolean().optional(),
  autonomy: z.enum(AUTONOMY).optional(),
}).refine((v) => v.enabled !== undefined || v.autonomy !== undefined, { message: "Nothing to change." });