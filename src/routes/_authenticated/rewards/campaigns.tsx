import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ExternalLink, Megaphone, Pencil, Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { CampaignForm } from "@/components/rewards/CampaignForm";
import {
  Button,
  Chip,
  EmptyState,
  LoadState,
  PageShell,
  Panel,
  day,
  errText,
  inputCls,
  int,
  usd,
} from "@/components/rewards/kit";
import { setCampaignStatusFn } from "@/lib/cr/cr.functions";
import {
  CAMPAIGN_STATUSES,
  PLATFORMS,
  PLATFORM_LABEL,
  budgetShare,
  isBudgetLow,
  msLeft,
  formatLeft,
  viewsAtCap,
  viewsToMinimum,
  type CampaignStatus,
} from "@/lib/cr/logic";
import { useCampaigns, useRefreshCr, type Campaign } from "@/lib/cr/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/rewards/campaigns")({
  head: () => ({
    meta: [
      { title: "APEX — Campaigns" },
      { name: "description", content: "Content Rewards campaigns." },
    ],
  }),
  component: CampaignsPage,
});

type SortKey = "score" | "rate" | "budget" | "deadline" | "newest";

const STATUS_TONE: Record<string, "neon" | "gold" | "muted" | "danger"> = {
  active: "neon",
  watching: "gold",
  paused: "muted",
  closed: "muted",
  rejected: "danger",
};

function Score({ n }: { n: number | null }) {
  if (n == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="tracking-[0.15em]" aria-label={`Score ${n} of 5`} title={`Score ${n} of 5`}>
      <span className="text-gold">{"●".repeat(n)}</span>
      <span className="text-muted-foreground/40">{"●".repeat(5 - n)}</span>
    </span>
  );
}

function BudgetBar({ c }: { c: Campaign }) {
  const share = budgetShare(c);
  const low = isBudgetLow(c);
  if (share == null)
    return <span className="text-muted-foreground">{usd(c.budget_remaining_usd, 0)}</span>;
  return (
    <div className="min-w-[140px]">
      <div className="mb-1 flex justify-between text-[11px] tabular-nums">
        <span className={low ? "text-destructive" : "text-foreground"}>
          {usd(c.budget_remaining_usd, 0)}
        </span>
        <span className="text-muted-foreground">{Math.round(share * 100)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-terminal">
        <div
          className={cn(
            "h-1.5 rounded-full",
            low ? "bg-destructive" : "bg-[color-mix(in_oklab,var(--neon)_75%,transparent)]",
          )}
          style={{ width: `${share * 100}%` }}
        />
      </div>
    </div>
  );
}

function CampaignsPage() {
  const campaigns = useCampaigns();
  const refresh = useRefreshCr();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | CampaignStatus>("all");
  const [platform, setPlatform] = useState<"all" | string>("all");
  const [sort, setSort] = useState<SortKey>("score");
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; campaign: Campaign | null }>({
    open: false,
    campaign: null,
  });
  const now = Date.now();

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (campaigns.data ?? []).filter(
      (c) =>
        (status === "all" || c.status === status) &&
        (platform === "all" || c.platforms.includes(platform)) &&
        (!term ||
          [c.title, c.brand, c.whop_url, c.notes].some((v) => v?.toLowerCase().includes(term))),
    );
    const val: Record<SortKey, (c: Campaign) => number> = {
      score: (c) => c.score ?? -1,
      rate: (c) => c.rate_per_1k_usd ?? -1,
      budget: (c) => c.budget_remaining_usd ?? -1,
      deadline: (c) => (c.deadline ? -Date.parse(c.deadline) : -Infinity),
      newest: (c) => Date.parse(c.created_at),
    };
    return [...list].sort((a, b) => val[sort](b) - val[sort](a));
  }, [campaigns.data, q, status, platform, sort]);

  const open = (campaigns.data ?? []).find((c) => c.id === openId) ?? null;
  const total = campaigns.data?.length ?? 0;

  return (
    <PageShell
      title="CAMPAIGNS"
      subtitle="Every Content Rewards campaign you are watching or clipping, scored by rate × remaining budget × fit."
      actions={
        <Button tone="gold" onClick={() => setForm({ open: true, campaign: null })}>
          <Plus className="size-3.5" /> ADD CAMPAIGN
        </Button>
      }
    >
      <LoadState loading={campaigns.isLoading} error={campaigns.error} />

      {!campaigns.isLoading && total === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="NO CAMPAIGNS YET"
          body="The Campaign Scout agent adds campaigns here as it finds them. You can also paste a campaign link from contentrewards.com yourself."
          action={
            <Button tone="gold" onClick={() => setForm({ open: true, campaign: null })}>
              <Plus className="size-3.5" /> ADD CAMPAIGN
            </Button>
          }
        />
      ) : (
        total > 0 && (
          <Panel>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <input
                className={cn(inputCls, "max-w-xs")}
                placeholder="Search title, brand, link…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <select
                className={cn(inputCls, "w-auto")}
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                aria-label="Status"
              >
                <option value="all">All statuses</option>
                {CAMPAIGN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                className={cn(inputCls, "w-auto")}
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                aria-label="Platform"
              >
                <option value="all">All platforms</option>
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {PLATFORM_LABEL[p]}
                  </option>
                ))}
              </select>
              <select
                className={cn(inputCls, "w-auto")}
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                aria-label="Sort"
              >
                <option value="score">Sort: score</option>
                <option value="rate">Sort: CPM</option>
                <option value="budget">Sort: budget left</option>
                <option value="deadline">Sort: deadline soonest</option>
                <option value="newest">Sort: newest</option>
              </select>
              <span className="ml-auto text-[11px] text-muted-foreground">
                {rows.length} of {total}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] tracking-widest text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3 font-normal">CAMPAIGN</th>
                    <th className="py-2 pr-3 font-normal">CPM</th>
                    <th className="py-2 pr-3 font-normal">BUDGET LEFT</th>
                    <th className="py-2 pr-3 font-normal">PLATFORMS</th>
                    <th className="py-2 pr-3 font-normal">SCORE</th>
                    <th className="py-2 pr-3 font-normal">STATUS</th>
                    <th className="py-2 font-normal">DEADLINE</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => setOpenId(c.id)}
                      className="cursor-pointer border-t border-border/50 align-middle transition-colors hover:bg-[color-mix(in_oklab,var(--neon)_5%,transparent)]"
                    >
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2">
                          {c.red_flags.length > 0 && (
                            <AlertTriangle
                              className="size-3.5 shrink-0 text-gold"
                              aria-label="Has red flags"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="max-w-[280px] truncate text-foreground">
                              {c.title || "Untitled campaign"}
                            </div>
                            <div className="max-w-[280px] truncate text-[11px] text-muted-foreground">
                              {c.brand || c.whop_url}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-gold">
                        {c.rate_per_1k_usd != null ? usd(c.rate_per_1k_usd) : "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <BudgetBar c={c} />
                      </td>
                      <td className="py-2 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {c.platforms.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            c.platforms.map((p) => (
                              <Chip key={p} tone="cyan">
                                {PLATFORM_LABEL[p] ?? p}
                              </Chip>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <Score n={c.score} />
                      </td>
                      <td className="py-2 pr-3">
                        <Chip tone={STATUS_TONE[c.status] ?? "muted"}>{c.status}</Chip>
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <div>{day(c.deadline)}</div>
                        {c.deadline && (
                          <div className="text-[11px] text-muted-foreground">
                            {formatLeft(msLeft(c.deadline, now))}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No campaign matches these filters.
                </p>
              )}
            </div>
          </Panel>
        )
      )}

      <CampaignDrawer
        campaign={open}
        onClose={() => setOpenId(null)}
        onEdit={(c) => setForm({ open: true, campaign: c })}
        onChanged={refresh}
      />

      {form.open && (
        <CampaignForm
          key={form.campaign?.id ?? "new"}
          open={form.open}
          onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))}
          campaign={form.campaign}
          onSaved={refresh}
        />
      )}
    </PageShell>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 border-t border-border/50 py-1.5 text-xs">
      <span className="text-[10px] tracking-[0.2em] text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-foreground">{children}</span>
    </div>
  );
}

function CampaignDrawer({
  campaign: c,
  onClose,
  onEdit,
  onChanged,
}: {
  campaign: Campaign | null;
  onClose: () => void;
  onEdit: (c: Campaign) => void;
  onChanged: () => void;
}) {
  const setStatus = useServerFn(setCampaignStatusFn);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const change = async (status: CampaignStatus) => {
    if (!c) return;
    setBusy(true);
    setError("");
    try {
      await setStatus({ data: { id: c.id, status } });
      onChanged();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const toMin = c ? viewsToMinimum(c) : null;
  const atCap = c ? viewsAtCap(c) : null;

  return (
    <Sheet open={!!c} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="panel w-full overflow-y-auto font-mono sm:max-w-lg">
        {c && (
          <>
            <SheetHeader>
              <SheetTitle className="text-neon font-display tracking-[0.15em]">
                {c.title || "Untitled campaign"}
              </SheetTitle>
              <SheetDescription className="text-xs">
                {c.brand ? `${c.brand} · ` : ""}
                <a
                  href={c.whop_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-neon hover:underline"
                >
                  Open campaign <ExternalLink className="size-3" />
                </a>
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 flex flex-wrap gap-2">
              {CAMPAIGN_STATUSES.map((s) => (
                <Button
                  key={s}
                  tone={c.status === s ? "neon" : "muted"}
                  disabled={busy || c.status === s}
                  onClick={() => change(s)}
                >
                  {s.toUpperCase()}
                </Button>
              ))}
              <Button tone="gold" onClick={() => onEdit(c)} className="ml-auto">
                <Pencil className="size-3" /> EDIT
              </Button>
            </div>
            {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

            {c.red_flags.length > 0 && (
              <div className="mt-4 rounded border border-[color-mix(in_oklab,var(--gold)_50%,transparent)] p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] tracking-[0.3em] text-gold">
                  <AlertTriangle className="size-3.5" /> RED FLAGS
                </div>
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-foreground">
                  {c.red_flags.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4">
              <div className="mb-1 text-[10px] tracking-[0.3em] text-neon">PAYOUT</div>
              <Row label="RATE / 1K">{usd(c.rate_per_1k_usd)}</Row>
              <Row label="BUDGET">
                {usd(c.budget_remaining_usd, 0)} left of {usd(c.budget_total_usd, 0)}
              </Row>
              <Row label="MIN PAYOUT">
                {usd(c.min_payout_usd)}
                {toMin != null && toMin > 0 ? ` · needs ${int(toMin)} views` : ""}
              </Row>
              <Row label="MAX PAYOUT">
                {usd(c.max_payout_usd)}
                {atCap != null ? ` · stops at ${int(atCap)} views` : ""}
              </Row>
              <Row label="FLAT FEE">{usd(c.flat_fee_usd)}</Row>
            </div>

            <div className="mt-4">
              <div className="mb-1 text-[10px] tracking-[0.3em] text-neon">SPEC</div>
              <Row label="CATEGORY">{c.category}</Row>
              <Row label="PLATFORMS">
                {c.platforms.length
                  ? c.platforms.map((p) => PLATFORM_LABEL[p] ?? p).join(", ")
                  : "—"}
              </Row>
              <Row label="LENGTH">
                {c.min_length_s != null || c.max_length_s != null
                  ? `${c.min_length_s ?? 0}–${c.max_length_s ?? "∞"} s`
                  : "—"}
              </Row>
              <Row label="HASHTAGS">
                {c.required_hashtags.length ? c.required_hashtags.join(" ") : "—"}
              </Row>
              <Row label="CREDIT">{c.required_credit || "—"}</Row>
              <Row label="DISCLOSURE">{c.disclosure_required ? "Required" : "Not stated"}</Row>
              <Row label="PROHIBITED">{c.prohibited || "—"}</Row>
              <Row label="DEADLINE">{day(c.deadline)}</Row>
              <Row label="SCORE">
                <Score n={c.score} />
              </Row>
              <Row label="SOURCES">
                {c.source_assets.length === 0 ? (
                  "—"
                ) : (
                  <ul className="space-y-0.5">
                    {c.source_assets.map((s) => (
                      <li key={s} className="truncate">
                        <a
                          href={s}
                          target="_blank"
                          rel="noreferrer"
                          className="text-neon hover:underline"
                        >
                          {s}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </Row>
              {c.notes && <Row label="NOTES">{c.notes}</Row>}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
