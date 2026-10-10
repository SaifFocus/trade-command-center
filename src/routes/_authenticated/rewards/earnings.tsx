import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ExternalLink, Wallet } from "lucide-react";
import {
  Chip,
  EmptyState,
  Kpi,
  LoadState,
  PageShell,
  Panel,
  compact,
  day,
  inputCls,
  int,
  usd,
  when,
} from "@/components/rewards/kit";
import {
  PLATFORM_LABEL,
  WHOP_FEE_PCT,
  approvalRate,
  estimateEarnings,
  formatLeft,
  msLeft,
  netPer1k,
  viewsForTarget,
} from "@/lib/cr/logic";
import { postNet, usePosts, type Post } from "@/lib/cr/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/rewards/earnings")({
  head: () => ({
    meta: [
      { title: "APEX — Earnings" },
      { name: "description", content: "Views, submissions and payouts per post." },
    ],
  }),
  component: EarningsPage,
});

const SUBMISSION_TONE: Record<string, "neon" | "gold" | "muted" | "danger" | "cyan"> = {
  pending: "muted",
  submitted: "cyan",
  approved: "neon",
  denied: "danger",
};

type StatusFilter = "all" | "pending" | "submitted" | "approved" | "denied" | "window";

function EarningsPage() {
  const posts = usePosts();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [target, setTarget] = useState("1000");
  const [avgViews, setAvgViews] = useState("10000");
  const now = Date.now();
  const all = useMemo(() => posts.data ?? [], [posts.data]);

  const k = useMemo(() => {
    const live = all.filter((p) => p.submission_status !== "denied");
    const views = all.reduce((s, p) => s + p.views_current, 0);
    const earned = live.reduce((s, p) => s + Math.max(postNet(p), p.paid_usd), 0);
    const paid = all.reduce((s, p) => s + p.paid_usd, 0);
    const belowMin = live.filter((p) => {
      const c = p.cr_clips?.cr_campaigns;
      return c ? estimateEarnings(p.views_current, c).belowMin : false;
    }).length;
    return {
      views,
      paid,
      pending: live.reduce((s, p) => s + Math.max(0, postNet(p) - p.paid_usd), 0),
      perK: netPer1k(earned, views),
      approval: approvalRate(all),
      decided: all.filter(
        (p) => p.submission_status === "approved" || p.submission_status === "denied",
      ).length,
      belowMin,
      inWindow: all.filter((p) => (msLeft(p.earning_window_ends_at, now) ?? 0) > 0).length,
    };
  }, [all, now]);

  const byCampaign = useMemo(() => {
    const m = new Map<
      string,
      {
        name: string;
        posts: number;
        views: number;
        net: number;
        paid: number;
        approved: number;
        denied: number;
      }
    >();
    for (const p of all) {
      const c = p.cr_clips?.cr_campaigns;
      const key = c?.id ?? "none";
      const row = m.get(key) ?? {
        name: c?.title || c?.brand || "Unknown campaign",
        posts: 0,
        views: 0,
        net: 0,
        paid: 0,
        approved: 0,
        denied: 0,
      };
      row.posts += 1;
      row.views += p.views_current;
      if (p.submission_status !== "denied") row.net += postNet(p);
      row.paid += p.paid_usd;
      if (p.submission_status === "approved") row.approved += 1;
      if (p.submission_status === "denied") row.denied += 1;
      m.set(key, row);
    }
    return [...m.values()].sort((a, b) => b.net - a.net);
  }, [all]);

  const rows = all.filter((p) =>
    status === "all"
      ? true
      : status === "window"
        ? (msLeft(p.earning_window_ends_at, now) ?? 0) > 0
        : p.submission_status === status,
  );

  // Target planner: uses your real net per 1,000 views once there is data, else the ~$1 average CPM.
  const targetUsd = Number(target) || 0;
  const avg = Number(avgViews) || 0;
  const perKNet = k.perK ?? 1 * (1 - WHOP_FEE_PCT);
  const viewsNeeded = viewsForTarget(targetUsd, perKNet / (1 - WHOP_FEE_PCT));
  const clipsPerDay = viewsNeeded != null && avg > 0 ? viewsNeeded / avg / 30 : null;

  return (
    <PageShell
      title="EARNINGS"
      subtitle="Views, submissions and payouts per post. Estimates are after the 10% clipper fee; Content Rewards' verified numbers win."
    >
      <LoadState loading={posts.isLoading} error={posts.error} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Kpi label="PAID TO DATE" value={usd(k.paid)} sub="settled to your balance" tone="neon" />
        <Kpi label="PENDING" value={usd(k.pending)} sub="estimated, not yet paid" tone="gold" />
        <Kpi
          label="VIEWS"
          value={compact(k.views)}
          sub={`${int(all.length)} posts · ${k.inWindow} still earning`}
          tone="cyan"
        />
        <Kpi
          label="NET PER 1K VIEWS"
          value={k.perK != null ? usd(k.perK) : "—"}
          sub="what a view is really worth"
        />
        <Kpi
          label="APPROVAL RATE"
          value={k.approval != null ? `${Math.round(k.approval * 100)}%` : "—"}
          sub={k.decided > 0 ? `of ${k.decided} decided submissions` : "no decisions yet"}
          tone={k.approval != null && k.approval < 0.8 ? "danger" : "muted"}
        />
        <Kpi
          label="BELOW MINIMUM"
          value={k.belowMin}
          sub="posts earning $0 so far"
          tone={k.belowMin > 0 ? "gold" : "muted"}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel title="BY CAMPAIGN" className="lg:col-span-2">
          {byCampaign.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Earnings per campaign show up after the first post is recorded.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-[10px] tracking-widest text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3 font-normal">CAMPAIGN</th>
                    <th className="py-1 pr-3 text-right font-normal">POSTS</th>
                    <th className="py-1 pr-3 text-right font-normal">VIEWS</th>
                    <th className="py-1 pr-3 text-right font-normal">NET / 1K</th>
                    <th className="py-1 pr-3 text-right font-normal">APPROVED</th>
                    <th className="py-1 pr-3 text-right font-normal">EST. NET</th>
                    <th className="py-1 text-right font-normal">PAID</th>
                  </tr>
                </thead>
                <tbody>
                  {byCampaign.map((r) => (
                    <tr key={r.name} className="border-t border-border/50">
                      <td className="max-w-[240px] truncate py-1.5 pr-3 text-foreground">
                        {r.name}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{r.posts}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{compact(r.views)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {usd(netPer1k(r.net, r.views))}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {r.approved + r.denied > 0
                          ? `${Math.round((r.approved / (r.approved + r.denied)) * 100)}%`
                          : "—"}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-gold">
                        {usd(r.net)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-neon">{usd(r.paid)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="MONTHLY TARGET">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] tracking-[0.25em] text-muted-foreground">
                NET TARGET ($/MO)
              </span>
              <input
                className={inputCls}
                inputMode="decimal"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] tracking-[0.25em] text-muted-foreground">
                AVG VIEWS / CLIP
              </span>
              <input
                className={inputCls}
                inputMode="numeric"
                value={avgViews}
                onChange={(e) => setAvgViews(e.target.value)}
              />
            </label>
          </div>
          <dl className="mt-4 space-y-2 text-xs">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Net per 1K views</dt>
              <dd className="tabular-nums">
                {usd(perKNet)}{" "}
                {k.perK == null && <span className="text-muted-foreground">(avg $1 CPM)</span>}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Paid views needed</dt>
              <dd className="font-display text-lg font-bold tabular-nums text-[var(--color-usstocks)]">
                {compact(viewsNeeded)}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Clips per day</dt>
              <dd className="font-display text-lg font-bold tabular-nums text-gold">
                {clipsPerDay != null ? clipsPerDay.toFixed(1) : "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Counts only clips that clear each campaign's minimum. Higher-CPM campaigns cut the
            volume fastest.
          </p>
        </Panel>
      </div>

      <Panel
        title="POSTS"
        right={
          all.length > 0 && (
            <select
              className={cn(inputCls, "w-auto")}
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              aria-label="Filter posts"
            >
              <option value="all">All posts</option>
              <option value="window">Still earning</option>
              <option value="pending">Not submitted</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
            </select>
          )
        }
      >
        {!posts.isLoading && all.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="NO POSTS YET"
            body="Posts appear once an approved clip goes live and the Publisher records its link. The Analyst then fills in views at 24 h, 72 h and 7 days."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] tracking-widest text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-normal">POST</th>
                  <th className="py-1 pr-3 font-normal">POSTED</th>
                  <th className="py-1 pr-3 text-right font-normal">24H</th>
                  <th className="py-1 pr-3 text-right font-normal">72H</th>
                  <th className="py-1 pr-3 text-right font-normal">7D</th>
                  <th className="py-1 pr-3 text-right font-normal">NOW</th>
                  <th className="py-1 pr-3 font-normal">REVIEW</th>
                  <th className="py-1 pr-3 font-normal">WINDOW</th>
                  <th className="py-1 pr-3 text-right font-normal">EST. NET</th>
                  <th className="py-1 text-right font-normal">PAID</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <PostRow key={p.id} post={p} now={now} />
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <p className="py-6 text-center text-xs text-muted-foreground">
                No post matches this filter.
              </p>
            )}
          </div>
        )}
      </Panel>
    </PageShell>
  );
}

function PostRow({ post: p, now }: { post: Post; now: number }) {
  const c = p.cr_clips?.cr_campaigns;
  const est = c ? estimateEarnings(p.views_current, c) : null;
  const left = msLeft(p.earning_window_ends_at, now);
  const acct = p.cr_accounts
    ? `${PLATFORM_LABEL[p.cr_accounts.platform] ?? p.cr_accounts.platform} @${p.cr_accounts.handle}`
    : (PLATFORM_LABEL[p.platform ?? ""] ?? p.platform);
  return (
    <tr className="border-t border-border/50 align-top">
      <td className="py-1.5 pr-3">
        <a
          href={p.post_url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex max-w-[260px] items-center gap-1 truncate text-foreground hover:text-neon"
        >
          <span className="truncate">{p.cr_clips?.hook || p.caption || p.post_url}</span>
          <ExternalLink className="size-3 shrink-0" />
        </a>
        <div className="max-w-[260px] truncate text-[11px] text-muted-foreground">
          {[c?.title || c?.brand, acct].filter(Boolean).join(" · ")}
        </div>
      </td>
      <td className="whitespace-nowrap py-1.5 pr-3 text-muted-foreground" title={when(p.posted_at)}>
        {day(p.posted_at)}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{compact(p.views_24h)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{compact(p.views_72h)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{compact(p.views_7d)}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-[var(--color-usstocks)]">
        {compact(p.views_current)}
      </td>
      <td className="py-1.5 pr-3">
        <Chip tone={SUBMISSION_TONE[p.submission_status] ?? "muted"}>
          {p.submission_status === "pending" ? "not submitted" : p.submission_status}
        </Chip>
        {p.denial_reason && (
          <div className="mt-1 max-w-[200px] text-[11px] text-destructive">{p.denial_reason}</div>
        )}
      </td>
      <td className="whitespace-nowrap py-1.5 pr-3">
        <span className={left != null && left > 0 ? "text-foreground" : "text-muted-foreground"}>
          {formatLeft(left)}
        </span>
        {p.payout_eta && (
          <div className="text-[11px] text-muted-foreground">payout ~{day(p.payout_eta)}</div>
        )}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-gold">
        {p.submission_status === "denied" ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          usd(postNet(p))
        )}
        {est?.belowMin && p.submission_status !== "denied" && (
          <div className="text-[10px] text-muted-foreground">below min</div>
        )}
        {est?.capped && <div className="text-[10px] text-muted-foreground">capped</div>}
      </td>
      <td className="py-1.5 text-right tabular-nums text-neon">{usd(p.paid_usd)}</td>
    </tr>
  );
}
