import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowDown, ArrowUp, ExternalLink, Megaphone, Pencil, Plus } from "lucide-react";
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
import { campaignsQueryOptions, useRefreshCr, type Campaign } from "@/lib/cr/queries";
import { campaignSearchSchema, filterCampaigns, type CampaignSearch } from "@/lib/cr/campaigns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/rewards/campaigns")({
  validateSearch: (search) => campaignSearchSchema.parse(search),
  loader: ({ context }) => context.queryClient.ensureQueryData(campaignsQueryOptions),
  errorComponent: CampaignLoadError,
  notFoundComponent: () => <p className="p-6 text-muted-foreground">Campaigns unavailable.</p>,
  head: () => ({
    meta: [
      { title: "APEX — Campaigns" },
      { name: "description", content: "Content Rewards campaigns." },
      { property: "og:title", content: "APEX — Campaigns" },
      { property: "og:description", content: "Content Rewards campaigns." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CampaignsPage,
});

function CampaignLoadError({ error }: { error: Error }) {
  const router = useRouter();
  return <div className="space-y-3 p-6"><p role="alert" className="text-destructive">{errText(error)}</p><Button onClick={() => { void router.invalidate(); }}>RETRY</Button></div>;
}

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
  const campaigns = useSuspenseQuery(campaignsQueryOptions);
  const refresh = useRefreshCr();
  const search = Route.useSearch();
  const { q, status, platform, sort, direction, budget } = search;
  const navigate = Route.useNavigate();
  const updateSearch = (patch: Partial<CampaignSearch>) => {
    void navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });
  };
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<{ open: boolean; campaign: Campaign | null }>({
    open: false,
    campaign: null,
  });
  const now = Date.now();

  const rows = useMemo(() => filterCampaigns(campaigns.data, search), [campaigns.data, search]);
  const draining = campaigns.data.filter(isBudgetLow);

  const open = (campaigns.data ?? []).find((c) => c.id === openId) ?? null;
  const total = campaigns.data?.length ?? 0;

  return (
    <PageShell
      title="CAMPAIGNS"
      actions={
        <Button tone="gold" onClick={() => setForm({ open: true, campaign: null })}>
          <Plus className="size-3.5" /> ADD CAMPAIGN
        </Button>
      }
    >
      <LoadState loading={false} error={campaigns.error} />

      {draining.length > 0 && (
        <section aria-label="Budget alerts" className="border-l-2 border-destructive bg-destructive/5 px-4 py-3">
          <h2 className="flex items-center gap-2 text-xs text-destructive"><AlertTriangle className="size-4" /> BUDGET DRAINING · {draining.length}</h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {draining.map((c) => <Button key={c.id} tone="danger" onClick={() => setOpenId(c.id)}>{c.title || c.brand || "Untitled campaign"} · {Math.round((budgetShare(c) ?? 0) * 100)}% LEFT</Button>)}
          </div>
        </section>
      )}

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
                aria-label="Search campaigns"
                value={q}
                onChange={(e) => updateSearch({ q: e.target.value })}
              />
              <select
                className={cn(inputCls, "w-auto")}
                value={status}
                onChange={(e) => updateSearch({ status: e.target.value as typeof status })}
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
                onChange={(e) => updateSearch({ platform: e.target.value as typeof platform })}
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
                onChange={(e) => updateSearch({ sort: e.target.value as typeof sort, direction: e.target.value === "deadline" ? "asc" : "desc" })}
                aria-label="Sort"
              >
                <option value="score">Sort: score</option>
                <option value="rate">Sort: CPM</option>
                <option value="budget">Sort: budget left</option>
                <option value="deadline">Sort: deadline soonest</option>
                <option value="newest">Sort: newest</option>
              </select>
              <Button title={direction === "asc" ? "Ascending order" : "Descending order"} onClick={() => updateSearch({ direction: direction === "asc" ? "desc" : "asc" })}>
                {direction === "asc" ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
              </Button>
              <select className={cn(inputCls, "w-auto")} value={budget} aria-label="Budget" onChange={(e) => updateSearch({ budget: e.target.value as typeof budget })}>
                <option value="all">All budgets</option><option value="low">Budget alerts</option>
              </select>
              {(q || status !== "all" || platform !== "all" || budget !== "all") && <Button tone="muted" onClick={() => updateSearch({ q: "", status: "all", platform: "all", budget: "all" })}>CLEAR FILTERS</Button>}
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
                              <Button tone="muted" onClick={() => setOpenId(c.id)} className="max-w-full border-0 bg-transparent p-0 text-left normal-case tracking-normal"><span className="truncate">{c.title || "Untitled campaign"}</span></Button>
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
  onChanged: () => void | Promise<void>;
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
      await onChanged();
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
            {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
            {isBudgetLow(c) && <p className="mt-3 flex items-center gap-2 text-xs text-destructive"><AlertTriangle className="size-4" /> Budget alert · under 15% remaining</p>}

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
