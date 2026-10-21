import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, CircleHelp, ExternalLink, X } from "lucide-react";
import { Button, Chip, errText, inputCls } from "./kit";
import { reviewClipFn } from "@/lib/cr/cr.functions";
import { specChecklist, STAGE_LABEL, type ClipStage } from "@/lib/cr/logic";
import type { Campaign, Clip } from "@/lib/cr/queries";
import { cn } from "@/lib/utils";

const isUrl = (s: string | null): s is string => !!s && /^https?:\/\//i.test(s);
const timecode = (s: number | null) => s == null ? "?" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function ClipReview({ clip, campaign, onDone }: {
  clip: Clip; campaign: Campaign | null; onDone: () => void | Promise<void>;
}) {
  const review = useServerFn(reviewClipFn);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  const checks = campaign ? specChecklist(campaign, clip) : [];
  const fails = checks.filter((c) => c.status === "fail").length;
  const awaiting = clip.stage === "awaiting_approval";
  const decide = async (decision: "approve" | "reject") => {
    setError("");
    if (decision === "reject" && !note.trim()) {
      setError("Add a note so the agents know why it was rejected.");
      return;
    }
    setBusy(decision);
    try {
      await review({ data: { id: clip.id, decision, note: note.trim() || undefined } });
      await onDone();
    } catch (e) { setError(errText(e)); }
    finally { setBusy(null); }
  };
  return <div className="space-y-4 text-xs">
    <div className="flex flex-wrap gap-2"><Chip tone={awaiting ? "gold" : clip.stage === "denied" ? "danger" : "neon"}>{STAGE_LABEL[clip.stage as ClipStage] ?? clip.stage}</Chip>{clip.variant && <Chip tone="cyan">{clip.variant}</Chip>}</div>
    <p className="break-words text-sm text-foreground">{clip.hook || "No hook yet"}</p>
    <div className="flex flex-wrap gap-3 text-muted-foreground">
      {isUrl(clip.source_url) && <a className="inline-flex items-center gap-1 text-neon hover:underline" href={clip.source_url} target="_blank" rel="noreferrer">Source {timecode(clip.source_start_s)}–{timecode(clip.source_end_s)} <ExternalLink className="size-3" /></a>}
      {isUrl(clip.file_ref) ? <a className="inline-flex items-center gap-1 text-neon hover:underline" href={clip.file_ref} target="_blank" rel="noreferrer">Watch render <ExternalLink className="size-3" /></a> : <span className="break-all">{clip.file_ref ? `File: ${clip.file_ref}` : "Render not attached"}</span>}
    </div>
    {clip.value_layer && <p className="break-words text-muted-foreground">Value layer: {clip.value_layer}</p>}
    <section aria-label="Spec checklist" className="border-y border-border py-3">
      <h3 className="mb-3 flex justify-between gap-2 text-[10px] text-neon">SPEC CHECKLIST {fails > 0 && <span className="text-destructive">{fails} FAILING</span>}</h3>
      {!campaign ? <p role="alert" className="text-destructive">Campaign spec unavailable.</p> : <ul className="space-y-3">
        {checks.map((item) => {
          const Icon = item.status === "ok" ? Check : item.status === "fail" ? X : CircleHelp;
          return <li key={item.label} className="flex items-start gap-2">
            <Icon aria-label={item.status === "ok" ? "Passes" : item.status === "fail" ? "Fails" : "Confirm"} className={cn("mt-0.5 size-3.5 shrink-0", item.status === "ok" ? "text-neon" : item.status === "fail" ? "text-destructive" : "text-gold")} />
            <div className="min-w-0"><span className="text-muted-foreground">{item.label}</span><p className={cn("break-words", item.status === "fail" ? "text-destructive" : "text-foreground")}>{item.detail}</p></div>
          </li>;
        })}
      </ul>}
    </section>
    {campaign && <div className="space-y-2 text-muted-foreground">
      <p>Platforms: {campaign.platforms.join(", ") || "Not specified"}</p>
      {campaign.red_flags.length > 0 && <ul className="list-disc space-y-1 pl-4 text-gold">{campaign.red_flags.map((flag) => <li key={flag}>{flag}</li>)}</ul>}
    </div>}
    {clip.qa_notes && <details><summary className="cursor-pointer text-muted-foreground">QA / OWNER NOTES</summary><pre className="mt-2 whitespace-pre-wrap break-words font-mono text-muted-foreground">{clip.qa_notes}</pre></details>}
    {awaiting && <>
      <label className="block space-y-2 text-muted-foreground">Review note<textarea className={cn(inputCls, "min-h-20")} placeholder="Required to reject; optional to approve" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} disabled={busy !== null} /></label>
      {error && <p role="alert" className="text-destructive">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button tone="danger" disabled={busy !== null} onClick={() => { void decide("reject"); }}><X className="size-3.5" />{busy === "reject" ? "REJECTING…" : "REJECT"}</Button>
        <Button tone="neon" disabled={busy !== null || !campaign} title={fails > 0 ? "Some spec checks fail; review before approving" : undefined} onClick={() => { void decide("approve"); }}><Check className="size-3.5" />{busy === "approve" ? "APPROVING…" : "APPROVE"}</Button>
      </div>
    </>}
  </div>;
}