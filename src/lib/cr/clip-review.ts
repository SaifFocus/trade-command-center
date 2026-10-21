import { z } from "zod";

export const clipReviewInput = z.object({
  id: z.string().uuid(),
  decision: z.enum(["approve", "reject"]),
  note: z.string().trim().max(2000).optional(),
}).refine((v) => v.decision === "approve" || (v.note ?? "").length > 0, {
  message: "Add a note so the agents know why it was rejected.", path: ["note"],
});

export function clipReviewUpdate(stage: string, qaNotes: string | null, decision: "approve" | "reject", note: string | undefined, stamp: string) {
  if (stage !== "awaiting_approval") throw new Error("This clip is no longer waiting for approval.");
  if (decision === "reject" && !note?.trim()) throw new Error("Add a note so the agents know why it was rejected.");
  const line = `[${stamp.slice(0, 16).replace("T", " ")} owner ${decision === "approve" ? "approved" : "rejected"}]${note?.trim() ? ` ${note.trim()}` : ""}`;
  return {
    stage: decision === "approve" ? "approved" : "denied",
    qa_notes: qaNotes ? `${qaNotes}\n${line}` : line,
    updated_at: stamp,
  };
}