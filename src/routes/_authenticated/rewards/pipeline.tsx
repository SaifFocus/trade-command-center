import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Clapperboard } from "lucide-react";
import { Chip, EmptyState, LoadState, PageShell, ago, inputCls } from "@/components/rewards/kit";
import { CLIP_STAGES, PLATFORM_LABEL, STAGE_LABEL, type ClipStage } from "@/lib/cr/logic";
import { useAccounts, useCampaigns, useClips, type Clip } from "@/lib/cr/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/rewards/pipeline")({
  head: () => ({
    meta: [
      { title: "APEX — Clip Pipeline" },
      { name: "description", content: "Every clip by stage." },
    ],
  }),
  component: PipelinePage,
});

const COLUMN_ACCENT: Partial<Record<ClipStage, string>> = {
  awaiting_approval: "border-t-[var(--gold)]",
  approved: "border-t-[var(--neon)]",
  paid: "border-t-[var(--neon)]",
  denied: "border-t-destructive",
};

const tc = (s: number | null) =>
  s == null ? "?" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function PipelinePage() {
  const clips = useClips();
  const campaigns = useCampaigns();
  const accounts = useAccounts();
  const [campaignId, setCampaignId] = useState("all");
  const [showDenied, setShowDenied] = useState(false);
  const now = Date.now();

  const handle = (id: string | null) => {
    const a = accounts.data?.find((x) => x.id === id);
    return a ? `${PLATFORM_LABEL[a.platform] ?? a.platform} @${a.handle}` : null;
  };

  const columns = useMemo(() => {
    const list = (clips.data ?? []).filter(
      (c) => campaignId === "all" || c.campaign_id === campaignId,
    );
    return CLIP_STAGES.filter((s) => showDenied || s !== "denied").map((stage) => ({
      stage,
      items: list.filter((c) => c.stage === stage),
    }));
  }, [clips.data, campaignId, showDenied]);

  const total = clips.data?.length ?? 0;

  return (
    <PageShell
      title="CLIP PIPELINE"
      subtitle="Clips move left to right as agents work on them. Only you can move a clip past approval."
      actions={
        total > 0 && (
          <>
            <select
              className={cn(inputCls, "w-auto")}
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              aria-label="Campaign"
            >
              <option value="all">All campaigns</option>
              {(campaigns.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title || c.brand || c.whop_url}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-[11px] tracking-widest text-muted-foreground">
              <input
                type="checkbox"
                checked={showDenied}
                onChange={(e) => setShowDenied(e.target.checked)}
                className="accent-[var(--neon)]"
              />
              SHOW DENIED
            </label>
          </>
        )
      }
    >
      <LoadState loading={clips.isLoading} error={clips.error} />

      {!clips.isLoading && total === 0 ? (
        <EmptyState
          icon={Clapperboard}
          title="NO CLIPS YET"
          body="The Clip Finder agent adds candidate moments here once a campaign is active. The Editor and QA Gatekeeper move them along until they reach Approvals."
        />
      ) : (
        total > 0 && (
          <div className="-mx-6 overflow-x-auto px-6 pb-2">
            <div className="flex min-w-max gap-3">
              {columns.map(({ stage, items }) => (
                <section
                  key={stage}
                  className={cn(
                    "panel flex w-64 shrink-0 flex-col rounded-lg border-t-2",
                    COLUMN_ACCENT[stage] ?? "border-t-border",
                  )}
                  aria-label={`${STAGE_LABEL[stage]}: ${items.length}`}
                >
                  <header className="flex items-center justify-between px-3 py-2">
                    <span
                      className={cn(
                        "text-[10px] tracking-[0.3em]",
                        stage === "awaiting_approval"
                          ? "text-gold"
                          : stage === "denied"
                            ? "text-destructive"
                            : "text-neon",
                      )}
                    >
                      {STAGE_LABEL[stage].toUpperCase()}
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {items.length}
                    </span>
                  </header>
                  <div className="flex max-h-[70vh] flex-col gap-2 overflow-y-auto px-2 pb-2">
                    {items.length === 0 ? (
                      <div className="rounded border border-dashed border-border/60 px-2 py-4 text-center text-[11px] text-muted-foreground/60">
                        Empty
                      </div>
                    ) : (
                      items.map((c) => <ClipCard key={c.id} clip={c} handle={handle} now={now} />)
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )
      )}
    </PageShell>
  );
}

function ClipCard({
  clip: c,
  handle,
  now,
}: {
  clip: Clip;
  handle: (id: string | null) => string | null;
  now: number;
}) {
  const where = c.cr_posts.map((p) => handle(p.account_id)).filter(Boolean) as string[];
  return (
    <article className="rounded border border-border bg-terminal p-2.5 text-xs">
      <div className="truncate text-[10px] tracking-wider text-muted-foreground">
        {c.cr_campaigns?.title || c.cr_campaigns?.brand || "Campaign"}
      </div>
      <p className="mt-1 line-clamp-3 text-foreground">
        {c.hook || <span className="text-muted-foreground">No hook yet</span>}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {c.variant && <Chip tone="cyan">{c.variant}</Chip>}
        {c.source_start_s != null && (
          <Chip>
            {tc(c.source_start_s)}–{tc(c.source_end_s)}
          </Chip>
        )}
        {where.map((w) => (
          <Chip key={w} tone="neon">
            {w}
          </Chip>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        <span>{c.created_by_agent ?? ""}</span>
        <span>{ago(c.updated_at, now)}</span>
      </div>
    </article>
  );
}
