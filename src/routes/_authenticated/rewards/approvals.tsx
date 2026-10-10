import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Check, CircleHelp, ExternalLink, ShieldCheck, X } from "lucide-react";
import {
  Button,
  Chip,
  EmptyState,
  LoadState,
  PageShell,
  Panel,
  ago,
  errText,
  inputCls,
} from "@/components/rewards/kit";
import { reviewClipFn } from "@/lib/cr/cr.functions";
import { specChecklist, type CheckItem } from "@/lib/cr/logic";
import { useCampaigns, useClips, useRefreshCr, type Campaign, type Clip } from "@/lib/cr/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/rewards/approvals")({
  head: () => ({
    meta: [
      { title: "APEX — Approvals" },
      { name: "description", content: "Clips waiting for the owner's sign-off." },
    ],
  }),
  component: ApprovalsPage,
});

const tc = (s: number | null) =>
  s == null ? "?" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const isUrl = (s: string | null): s is string => !!s && /^https?:\/\//i.test(s);

function ApprovalsPage() {
  const clips = useClips();
  const campaigns = useCampaigns();
  const refresh = useRefreshCr();
  const queue = (clips.data ?? [])
    .filter((c) => c.stage === "awaiting_approval")
    .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
  const byId = new Map((campaigns.data ?? []).map((c) => [c.id, c]));

  return (
    <PageShell
      title="APPROVALS"
      subtitle="Nothing is posted until you approve it here. Oldest first."
      actions={queue.length > 0 && <Chip tone="gold">{queue.length} waiting</Chip>}
    >
      <LoadState loading={clips.isLoading} error={clips.error} />
      {!clips.isLoading && queue.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="QUEUE CLEAR"
          body="The QA Gatekeeper sends clips here once they pass the campaign spec. Approved clips go to the Publisher; rejected ones go back with your note."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {queue.map((c) => (
            <ApprovalCard
              key={c.id}
              clip={c}
              campaign={byId.get(c.campaign_id) ?? null}
              onDone={refresh}
            />
          ))}
        </div>
      )}
    </PageShell>
  );
}

function CheckRow({ item }: { item: CheckItem }) {
  const Icon = item.status === "ok" ? Check : item.status === "fail" ? X : CircleHelp;
  return (
    <li className="flex items-start gap-2 text-xs">
      <Icon
        className={cn(
          "mt-0.5 size-3.5 shrink-0",
          item.status === "ok"
            ? "text-neon"
            : item.status === "fail"
              ? "text-destructive"
              : "text-gold",
        )}
        aria-label={item.status === "ok" ? "Passes" : item.status === "fail" ? "Fails" : "Confirm"}
      />
      <span className="w-24 shrink-0 text-muted-foreground">{item.label}</span>
      <span
        className={cn(
          "min-w-0 break-words",
          item.status === "fail" ? "text-destructive" : "text-foreground",
        )}
      >
        {item.detail}
      </span>
    </li>
  );
}

function ApprovalCard({
  clip: c,
  campaign,
  onDone,
}: {
  clip: Clip;
  campaign: Campaign | null;
  onDone: () => void;
}) {
  const review = useServerFn(reviewClipFn);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  const checks = campaign ? specChecklist(campaign, c) : [];
  const fails = checks.filter((i) => i.status === "fail").length;

  const decide = async (decision: "approve" | "reject") => {
    setError("");
    if (decision === "reject" && !note.trim()) {
      setError("Add a note so the agents know why it was rejected.");
      return;
    }
    setBusy(decision);
    try {
      await review({ data: { id: c.id, decision, note: note.trim() || undefined } });
      onDone();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title={(campaign?.title || c.cr_campaigns?.title || "CAMPAIGN").toUpperCase()}
      right={
        <div className="flex items-center gap-2">
          {c.variant && <Chip tone="cyan">{c.variant}</Chip>}
          <span className="text-[10px] text-muted-foreground">waiting {ago(c.updated_at)}</span>
        </div>
      }
    >
      <p className="text-sm text-foreground">
        {c.hook || <span className="text-muted-foreground">No hook text</span>}
      </p>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        {isUrl(c.source_url) && (
          <a
            href={c.source_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-neon hover:underline"
          >
            Source {tc(c.source_start_s)}–{tc(c.source_end_s)} <ExternalLink className="size-3" />
          </a>
        )}
        {isUrl(c.file_ref) ? (
          <a
            href={c.file_ref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-neon hover:underline"
          >
            Watch render <ExternalLink className="size-3" />
          </a>
        ) : (
          c.file_ref && <span>File: {c.file_ref}</span>
        )}
        {c.value_layer && <span>Value layer: {c.value_layer}</span>}
        {c.created_by_agent && <span>By {c.created_by_agent}</span>}
      </div>

      {checks.length > 0 && (
        <div className="mt-3 rounded border border-border bg-terminal p-3">
          <div className="mb-2 flex items-center justify-between text-[10px] tracking-[0.3em]">
            <span className="text-neon">SPEC CHECK</span>
            {fails > 0 ? (
              <span className="text-destructive">{fails} FAILING</span>
            ) : (
              <span className="text-muted-foreground">CONFIRM THE ? ITEMS</span>
            )}
          </div>
          <ul className="space-y-1">
            {checks.map((i) => (
              <CheckRow key={i.label} item={i} />
            ))}
          </ul>
        </div>
      )}

      {c.qa_notes && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-[10px] tracking-[0.3em] text-muted-foreground">
            QA NOTES
          </summary>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
            {c.qa_notes}
          </pre>
        </details>
      )}

      <textarea
        className={cn(inputCls, "mt-3 min-h-14")}
        placeholder="Note (required to reject; optional to approve)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        aria-label="Review note"
      />
      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <Button tone="danger" onClick={() => decide("reject")} disabled={busy !== null}>
          <X className="size-3.5" /> {busy === "reject" ? "REJECTING…" : "REJECT"}
        </Button>
        <Button
          tone="neon"
          onClick={() => decide("approve")}
          disabled={busy !== null}
          title={fails > 0 ? "Some spec checks fail; approve only if you are sure" : undefined}
        >
          <Check className="size-3.5" /> {busy === "approve" ? "APPROVING…" : "APPROVE"}
        </Button>
      </div>
    </Panel>
  );
}
