import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { z } from "zod";
import { ReportingError, ReportingNotFound, useReportingNow } from "@/components/rewards/ReportingState";
import { earningsReport, isEarning } from "@/lib/cr/reporting";
import { ExternalLink, Wallet } from "lucide-react";
import {
  Chip,
  EmptyState,
  Kpi,
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
  approvalRate,
  estimateEarnings,
  formatLeft,
  msLeft,
  netPer1k,
} from "@/lib/cr/logic";
import { postNet, postsQueryOptions, type Post } from "@/lib/cr/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/rewards/earnings")({
  validateSearch: z.object({ status: z.enum(["all", "pending", "submitted", "approved", "denied", "window"]).catch("all").default("all") }),
  loader: ({ context }) => context.queryClient.ensureQueryData(postsQueryOptions),
  errorComponent: ReportingError,
  notFoundComponent: ReportingNotFound,
  head: () => ({
    meta: [
      { title: "APEX — Earnings" },
      { name: "description", content: "Views, submissions and payouts per post." },
      { property: "og:title", content: "APEX — Earnings" },
      { property: "og:description", content: "Views, submissions and payouts per post." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
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

const statusSchema = z.enum(["all", "pending", "submitted", "approved", "denied", "window"]);

function EarningsPage() {
  const posts = useSuspenseQuery(postsQueryOptions);
  const { status } = Route.useSearch();
  const navigate = Route.useNavigate();
  const now = useReportingNow();
  const all = useMemo(() => posts.data ?? [], [posts.data]);

  const k = useMemo(() => {
    const live = all.filter((p) => p.submission_status !== "denied");
    const report = earningsReport(all, now);
    const views = report.observedViews;
    const earned = live.reduce((s, p) => s + Math.max(postNet(p), p.paid_usd), 0);
    const paid = report.paid;
    const belowMin = live.filter((p) => {
      const c = p.cr_clips?.cr_campaigns;
      return c ? estimateEarnings(p.views_current, c).belowMin : false;
    }).length;
    return {
      views,
      paid,
      pending: report.pending,
      verifiedViews: report.verifiedViews,
      nextEta: report.nextEta,
      unknownWindow: report.unknownWindow,
      perK: netPer1k(earned, views),
      approval: approvalRate(all),
      decided: all.filter(
        (p) => p.submission_status === "approved" || p.submission_status === "denied",
      ).length,
      belowMin,
      inWindow: report.inWindow,
    };
  }, [all, now]);

  const byCampaign = useMemo(() => {
    const m = new Map<
      string,
      {
        id: string;
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
        id: key,
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
        ? isEarning(p, now)
        : p.submission_status === status,
  );

  return (
    <PageShell
      title="EARNINGS"
      subtitle="USD estimates, recorded payments and post earning deadlines."
    >

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        <Kpi label="PAID TO DATE" value={usd(k.paid)} sub="recorded payments · USD" tone="neon" />
        <Kpi label="PENDING" value={usd(k.pending)} sub="estimated, not yet paid" tone="gold" />
        <Kpi
          label="OBSERVED VIEWS"
          value={compact(k.views)}
          sub={`${int(all.length)} posts · lifetime counters`}
          tone="cyan"
        />
        <Kpi label="VERIFIED VIEWS" value={compact(k.verifiedViews)} sub="not reported separately" />
        <Kpi label="IN EARNING WINDOW" value={k.inWindow} sub={`${k.unknownWindow} deadlines unknown`} />
        <Kpi
          label="NET PER 1K VIEWS"
          value={k.perK != null ? usd(k.perK) : "—"}
          sub="estimated / recorded · observed views"
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
                    <tr key={r.id} className="border-t border-border/50">
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

        <Panel title="PAYOUT SUMMARY">
          <dl className="space-y-4 text-xs">
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Estimated unpaid</dt><dd className="tabular-nums text-gold">{usd(k.pending)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Recorded payments</dt><dd className="tabular-nums text-neon">{usd(k.paid)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Next unpaid payout ETA</dt><dd className="text-right">{k.nextEta ? when(k.nextEta) : "Not scheduled"}</dd></div>
          </dl>
          <p className="mt-5 text-xs text-muted-foreground">Estimates are net of the 10% creator fee. Approval status does not verify view counts; verified views have not been reported separately.</p>
        </Panel>
      </div>

      <Panel
        title="POSTS"
        right={
          all.length > 0 && (
            <select
              className={cn(inputCls, "w-auto")}
              value={status}
              onChange={(e) => { const value = statusSchema.parse(e.target.value); void navigate({ search: (prev) => ({ ...prev, status: value }) }); }}
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
        {all.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="NO POSTS YET"
            body="No recorded posts, view metrics or payments yet."
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
                  <th className="py-1 pr-3 text-right font-normal">OBSERVED</th>
                  <th className="py-1 pr-3 font-normal">VERIFIED</th>
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
      <td className="py-1.5 pr-3 text-muted-foreground">Not reported</td>
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
          {p.submission_status === "denied" ? "ineligible" : left == null ? "Unknown" : formatLeft(left)}
        </span>
        {p.earning_window_ends_at && <div className="text-[11px] text-muted-foreground">ends {when(p.earning_window_ends_at)}</div>}
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
