import { describe, expect, it } from "vitest";
import { clipReviewInput, clipReviewUpdate } from "./clip-review";
import { CLIP_STAGES } from "./logic";

const id = "00000000-0000-4000-8000-000000000001";
const stamp = "2026-10-21T03:04:00Z";
describe("owner clip decisions", () => {
  it("requires a nonblank rejection note", () => {
    expect(clipReviewInput.safeParse({ id, decision: "reject", note: "  " }).success).toBe(false);
    expect(clipReviewInput.parse({ id, decision: "reject", note: " Fix captions " }).note).toBe("Fix captions");
  });
  it("approves only awaiting clips and preserves QA history with the note", () => {
    expect(clipReviewUpdate("awaiting_approval", "QA passed", "approve", "Ready", stamp)).toEqual({
      stage: "approved", qa_notes: "QA passed\n[2026-10-21 03:04 owner approved] Ready", updated_at: stamp,
    });
  });
  it("rejects to denied with the owner's reason", () => {
    expect(clipReviewUpdate("awaiting_approval", null, "reject", "Fix captions", stamp)).toEqual({
      stage: "denied", qa_notes: "[2026-10-21 03:04 owner rejected] Fix captions", updated_at: stamp,
    });
  });
  it("refuses decisions from every other stage", () => {
    for (const stage of CLIP_STAGES.filter((s) => s !== "awaiting_approval")) {
      expect(() => clipReviewUpdate(stage, null, "approve", undefined, stamp)).toThrow("no longer waiting");
      expect(() => clipReviewUpdate(stage, null, "reject", "Fix", stamp)).toThrow("no longer waiting");
    }
  });
  it("allows approval without a note but rejects unknown decisions", () => {
    expect(clipReviewInput.safeParse({ id, decision: "approve" }).success).toBe(true);
    expect(clipReviewInput.safeParse({ id, decision: "post" }).success).toBe(false);
  });
});