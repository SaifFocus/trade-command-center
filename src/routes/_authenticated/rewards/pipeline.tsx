import { createFileRoute, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Clapperboard } from "lucide-react";
import { Button, Chip, EmptyState, PageShell, ago, errText, inputCls } from "@/components/rewards/kit";
import { ClipReview } from "@/components/rewards/ClipReview";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { CLIP_STAGES, PLATFORM_LABEL, STAGE_LABEL, type ClipStage } from "@/lib/cr/logic";
import { accountsQueryOptions, campaignsQueryOptions, clipsQueryOptions, useRefreshCr, type Clip } from "@/lib/cr/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/rewards/pipeline")({
  loader: ({ context }) => Promise.all([
    context.queryClient.ensureQueryData(clipsQueryOptions),
    context.queryClient.ensureQueryData(campaignsQueryOptions),
    context.queryClient.ensureQueryData(accountsQueryOptions),
  ]),
  errorComponent: PipelineError,
  head: () => ({
    meta: [
      { title: "APEX — Clip Pipeline" },
      { name: "description", content: "Every clip by stage." },
      { property: "og:title", content: "APEX — Clip Pipeline" },
      { property: "og:description", content: "Every clip by stage." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PipelinePage,
});

function PipelineError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return <div className="space-y-3 p-6"><p role="alert" className="text-destructive">{errText(error)}</p><Button onClick={() => { void router.invalidate(); }}>RETRY</Button></div>;
}

const COLUMN_ACCENT: Partial<Record<ClipStage, string>> = {
  awaiting_approval: "border-t-[var(--gold)]",
  approved: "border-t-[var(--neon)]",
  paid: "border-t-[var(--neon)]",
  denied: "border-t-destructive",
};

const tc = (s: number | null) =>
  s == null ? "?" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

function PipelinePage() {
  const clips = useSuspenseQuery(clipsQueryOptions);
  const campaigns = useSuspenseQuery(campaignsQueryOptions);
  const accounts = useSuspenseQuery(accountsQueryOptions);
  const refresh = useRefreshCr();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = clips.data.find((c) => c.id === selectedId);
  const [campaignId, setCampaignId] = useState("all");
  const [showDenied, setShowDenied] = useState(true);
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
      {total === 0 ? (
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
                    "flex w-64 shrink-0 flex-col border-t-2",
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
                        No clips at this stage yet
                      </div>
                    ) : (
                      items.map((c) => <ClipCard key={c.id} clip={c} handle={handle} now={now} onOpen={() => setSelectedId(c.id)} />)
                    )}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )
      )}
      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-4"><SheetTitle className="break-words text-neon">{selected?.cr_campaigns?.title || selected?.cr_campaigns?.brand || "Clip details"}</SheetTitle><SheetDescription>Campaign specification and review</SheetDescription></SheetHeader>
          {selected && <ClipReview key={selected.id} clip={selected} campaign={campaigns.data.find((c) => c.id === selected.campaign_id) ?? null} onDone={async () => { await refresh(); setSelectedId(null); }} />}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}

function ClipCard({
  clip: c,
  handle,
  now,
  onOpen,
}: {
  clip: Clip;
  handle: (id: string | null) => string | null;
  now: number;
  onOpen: () => void;
}) {
  const where = [...new Set(c.cr_posts.map((p) => handle(p.account_id)).filter(Boolean))];
  return (
    <article className="rounded border border-border bg-terminal p-2.5 text-xs">
      <div className="truncate text-[10px] tracking-wider text-muted-foreground">
        {c.cr_campaigns?.title || c.cr_campaigns?.brand || "Campaign"}
      </div>
      {where.length === 0 && <p className="mt-2 text-[10px] text-muted-foreground">Account unassigned</p>}
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
      <Button className="mt-3 w-full justify-center" tone={c.stage === "awaiting_approval" ? "gold" : "muted"} onClick={onOpen}>{c.stage === "awaiting_approval" ? "REVIEW CLIP" : "VIEW DETAILS"}</Button>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
        <span>{c.created_by_agent ?? ""}</span>
        <span>{ago(c.updated_at, now)}</span>
      </div>
    </article>
  );
}
