import { estimateEarnings, msLeft, type PayoutTerms } from "./logic";

export type ReportingPost = {
  submission_status: string;
  views_current: number;
  est_earnings_usd: number;
  paid_usd: number;
  earning_window_ends_at: string | null;
  payout_eta: string | null;
  cr_clips: { cr_campaigns: PayoutTerms | null } | null;
};

/** Stored Analyst estimates are already net USD; do not charge the fee twice. */
export function estimatedNet(p: ReportingPost): number {
  if (p.submission_status === "denied") return 0;
  if (p.est_earnings_usd > 0) return p.est_earnings_usd;
  const terms = p.cr_clips?.cr_campaigns;
  return terms ? estimateEarnings(p.views_current, terms).net : 0;
}

export function isEarning(p: ReportingPost, now: number): boolean {
  return p.submission_status !== "denied" && (msLeft(p.earning_window_ends_at, now) ?? 0) > 0;
}

export function earningsReport(posts: ReportingPost[], now: number) {
  const eligible = posts.filter((p) => p.submission_status !== "denied");
  const pendingFor = (p: ReportingPost) => Math.max(0, estimatedNet(p) - p.paid_usd);
  const etas = eligible.filter((p) => p.payout_eta && Number.isFinite(Date.parse(p.payout_eta)) && pendingFor(p) > 0)
    .map((p) => p.payout_eta as string).sort((a, b) => Date.parse(a) - Date.parse(b));
  return {
    observedViews: posts.reduce((sum, p) => sum + p.views_current, 0),
    // Existing metrics have no verification provenance. Approval is not view verification.
    verifiedViews: null,
    estimated: eligible.reduce((sum, p) => sum + estimatedNet(p), 0),
    pending: eligible.reduce((sum, p) => sum + pendingFor(p), 0),
    paid: posts.reduce((sum, p) => sum + p.paid_usd, 0),
    inWindow: posts.filter((p) => isEarning(p, now)).length,
    unknownWindow: eligible.filter((p) => msLeft(p.earning_window_ends_at, now) == null).length,
    nextEta: etas[0] ?? null,
  };
}