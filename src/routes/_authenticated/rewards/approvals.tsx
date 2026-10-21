import { createFileRoute, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { Button, Chip, EmptyState, PageShell, ago, errText } from "@/components/rewards/kit";
import { ClipReview } from "@/components/rewards/ClipReview";
import { campaignsQueryOptions, clipsQueryOptions, useRefreshCr } from "@/lib/cr/queries";

export const Route = createFileRoute("/_authenticated/rewards/approvals")({
  loader: ({ context }) => Promise.all([
    context.queryClient.ensureQueryData(clipsQueryOptions),
    context.queryClient.ensureQueryData(campaignsQueryOptions),
  ]),
  errorComponent: ApprovalError,
  notFoundComponent: () => <p className="p-6">Approvals unavailable.</p>,
  head: () => ({ meta: [
    { title: "APEX — Clip Approvals" },
    { name: "description", content: "Owner review queue with campaign specifications and clip decisions." },
    { property: "og:title", content: "APEX — Clip Approvals" },
    { property: "og:description", content: "Owner review queue with campaign specifications and clip decisions." },
    { property: "og:type", content: "website" }, { name: "twitter:card", content: "summary" },
  ] }),
  component: ApprovalsPage,
});
function ApprovalError({ error }: ErrorComponentProps) {
  const router = useRouter();
  return <div className="space-y-3 p-6"><p role="alert" className="text-destructive">{errText(error)}</p><Button onClick={() => { void router.invalidate(); }}>RETRY</Button></div>;
}
function ApprovalsPage() {
  const { data: clips } = useSuspenseQuery(clipsQueryOptions);
  const { data: campaigns } = useSuspenseQuery(campaignsQueryOptions);
  const refresh = useRefreshCr();
  const queue = clips.filter((c) => c.stage === "awaiting_approval").sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  return <PageShell title="APPROVALS" actions={<Chip tone="gold">{queue.length} waiting</Chip>}>
    {queue.length === 0 ? <EmptyState icon={ShieldCheck} title="QUEUE CLEAR" body="The QA Gatekeeper adds clips here when they are ready for your review." /> :
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{queue.map((clip) => <article key={clip.id} aria-label={clip.hook || "Clip review"} className="min-w-0 rounded-lg border border-border bg-terminal p-4">
        <header className="mb-4 flex flex-wrap items-start justify-between gap-2"><h2 className="min-w-0 break-words text-xs text-neon">{byId.get(clip.campaign_id)?.title || clip.cr_campaigns?.title || "CAMPAIGN"}</h2><span className="text-[10px] text-muted-foreground">waiting {ago(clip.updated_at)}</span></header>
        <ClipReview clip={clip} campaign={byId.get(clip.campaign_id) ?? null} onDone={refresh} />
      </article>)}</div>}
  </PageShell>;
}