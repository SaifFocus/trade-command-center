// Pure Content Rewards rules shared by the /rewards pages. No I/O here; tests in logic.test.ts.

/** Content Rewards takes a flat 10% creator fee off every CPM payout (terms §5.1, Oct 2026). */
export const WHOP_FEE_PCT = 0.1;
/** A campaign counts as "draining" below this share of its budget. */
export const LOW_BUDGET_SHARE = 0.15;

export const CLIP_STAGES = [
  "found",
  "cut",
  "qa",
  "awaiting_approval",
  "approved",
  "posted",
  "submitted",
  "tracking",
  "paid",
  "denied",
] as const;
export type ClipStage = (typeof CLIP_STAGES)[number];

export const STAGE_LABEL: Record<ClipStage, string> = {
  found: "Found",
  cut: "Cut",
  qa: "QA",
  awaiting_approval: "Awaiting approval",
  approved: "Approved",
  posted: "Posted",
  submitted: "Submitted",
  tracking: "Tracking",
  paid: "Paid",
  denied: "Denied",
};

/** Stages where a clip is still being produced or waiting for the owner. */
export const IN_PIPELINE: readonly ClipStage[] = [
  "found",
  "cut",
  "qa",
  "awaiting_approval",
  "approved",
];

export const CAMPAIGN_STATUSES = ["watching", "active", "paused", "closed", "rejected"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const PLATFORMS = ["tiktok", "instagram", "youtube", "x", "other"] as const;
export type Platform = (typeof PLATFORMS)[number];
export const PLATFORM_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  other: "Other",
};

export const ACCOUNT_STATUSES = ["active", "warming", "restricted", "banned"] as const;
export const AUTONOMY = ["manual", "assisted", "auto"] as const;
export type Autonomy = (typeof AUTONOMY)[number];

/** Agents whose output goes public; switching them to auto needs an explicit confirmation in the UI. */
export const PUBLIC_FACING_AGENTS = ["publisher", "submitter"];

export type PayoutTerms = {
  rate_per_1k_usd: number | null;
  min_payout_usd: number | null;
  max_payout_usd: number | null;
  flat_fee_usd: number | null;
};

export type Estimate = {
  gross: number;
  net: number;
  belowMin: boolean;
  capped: boolean;
};

/**
 * What a post should earn from Whop: views × rate / 1000, nothing below the minimum payout
 * (the clip never reaches review), view earnings capped at the max payout, plus the flat fee,
 * minus the fee. Whop's verified numbers always win over this estimate.
 */
export function estimateEarnings(
  views: number,
  terms: PayoutTerms,
  feePct = WHOP_FEE_PCT,
): Estimate {
  const rate = Math.max(0, terms.rate_per_1k_usd ?? 0);
  const v = Math.max(0, Number.isFinite(views) ? views : 0);
  const fromViews = (v / 1000) * rate;
  const min = terms.min_payout_usd ?? 0;
  if (min > 0 && fromViews < min) return { gross: 0, net: 0, belowMin: true, capped: false };
  const max = terms.max_payout_usd;
  const capped = max != null && max > 0 && fromViews > max;
  const gross = (capped ? (max as number) : fromViews) + Math.max(0, terms.flat_fee_usd ?? 0);
  return { gross: round2(gross), net: round2(gross * (1 - feePct)), belowMin: false, capped };
}

/** Views a clip needs before it earns anything (reaches the minimum payout). */
export function viewsToMinimum(terms: PayoutTerms): number | null {
  const rate = terms.rate_per_1k_usd ?? 0;
  const min = terms.min_payout_usd ?? 0;
  if (rate <= 0) return null;
  return Math.ceil((min / rate) * 1000);
}

/** Views at which a clip stops earning (hits the max payout). */
export function viewsAtCap(terms: PayoutTerms): number | null {
  const rate = terms.rate_per_1k_usd ?? 0;
  const max = terms.max_payout_usd ?? 0;
  if (rate <= 0 || max <= 0) return null;
  return Math.floor((max / rate) * 1000);
}

export type BudgetFields = {
  status: string;
  budget_total_usd: number | null;
  budget_remaining_usd: number | null;
};

/** Share of budget left, 0–1, or null when unknown. */
export function budgetShare(c: BudgetFields): number | null {
  const total = c.budget_total_usd ?? 0;
  if (total <= 0 || c.budget_remaining_usd == null) return null;
  return Math.min(1, Math.max(0, c.budget_remaining_usd / total));
}

export function isBudgetLow(c: BudgetFields, threshold = LOW_BUDGET_SHARE): boolean {
  const share = budgetShare(c);
  return c.status === "active" && share != null && share < threshold;
}

/** Milliseconds left until `endsAt`, 0 once passed, null when unknown. */
export function msLeft(endsAt: string | null | undefined, now: number): number | null {
  if (!endsAt) return null;
  const t = Date.parse(endsAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, t - now);
}

/** "2d 4h", "5h 12m", "ended". */
export function formatLeft(ms: number | null): string {
  if (ms == null) return "—";
  if (ms <= 0) return "ended";
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d > 0) return `${d}d ${h}h`;
  return `${h}h ${m % 60}m`;
}

export type CheckStatus = "ok" | "fail" | "check";
export type CheckItem = { label: string; status: CheckStatus; detail: string };

export type SpecFields = {
  min_length_s: number | null;
  max_length_s: number | null;
  required_hashtags: string[];
  required_credit: string | null;
  disclosure_required: boolean;
  source_assets: string[];
  prohibited: string | null;
};

export type ClipFields = {
  source_url: string | null;
  source_start_s: number | null;
  source_end_s: number | null;
  hook: string | null;
};

/**
 * The checklist shown on each approval card. Length, source and hook can be checked from the
 * clip itself; hashtags, credit, disclosure and banned themes live in the caption and the post
 * settings, so they are listed for the owner to confirm.
 */
export function specChecklist(spec: SpecFields, clip: ClipFields): CheckItem[] {
  const items: CheckItem[] = [];

  const len =
    clip.source_start_s != null && clip.source_end_s != null
      ? clip.source_end_s - clip.source_start_s
      : null;
  if (len == null) {
    items.push({ label: "Length", status: "check", detail: "No timecodes on this clip" });
  } else {
    const tooShort = spec.min_length_s != null && len < spec.min_length_s;
    const tooLong = spec.max_length_s != null && len > spec.max_length_s;
    const range =
      spec.min_length_s != null || spec.max_length_s != null
        ? ` (allowed ${spec.min_length_s ?? 0}–${spec.max_length_s ?? "∞"} s)`
        : "";
    items.push({
      label: "Length",
      status: tooShort || tooLong ? "fail" : "ok",
      detail: `${Math.round(len)} s${range}`,
    });
  }

  if (spec.source_assets.length === 0) {
    items.push({
      label: "Source",
      status: "check",
      detail: "Campaign lists no source assets — confirm it is authorised",
    });
  } else if (!clip.source_url) {
    items.push({ label: "Source", status: "fail", detail: "Clip has no source link" });
  } else {
    const ok = spec.source_assets.some((a) => sameSource(a, clip.source_url as string));
    items.push({
      label: "Source",
      status: ok ? "ok" : "fail",
      detail: ok ? "From the campaign's source list" : "Not in the campaign's source list",
    });
  }

  items.push(
    clip.hook && clip.hook.trim()
      ? { label: "Hook", status: "check", detail: "Confirm it is true to the footage" }
      : { label: "Hook", status: "fail", detail: "No hook text" },
  );

  if (spec.required_hashtags.length > 0) {
    items.push({ label: "Hashtags", status: "check", detail: spec.required_hashtags.join(" ") });
  }
  if (spec.required_credit) {
    items.push({ label: "Credit", status: "check", detail: spec.required_credit });
  }
  if (spec.disclosure_required) {
    items.push({
      label: "Disclosure",
      status: "check",
      detail: "Paid-partnership / commercial toggle on",
    });
  }
  if (spec.prohibited) {
    items.push({ label: "Banned themes", status: "check", detail: spec.prohibited });
  }
  return items;
}

/** Share of decided Whop submissions the brand approved, 0–1, or null before any decision. */
export function approvalRate(posts: { submission_status: string }[]): number | null {
  const decided = posts.filter(
    (p) => p.submission_status === "approved" || p.submission_status === "denied",
  );
  if (decided.length === 0) return null;
  return decided.filter((p) => p.submission_status === "approved").length / decided.length;
}

/** Net dollars earned per 1,000 views, or null without views. */
export function netPer1k(netUsd: number, views: number): number | null {
  if (!(views > 0)) return null;
  return round2((netUsd / views) * 1000);
}

/** Paid views needed in a month to net `targetUsd` at a headline CPM, after the fee. */
export function viewsForTarget(
  targetUsd: number,
  cpm: number,
  feePct = WHOP_FEE_PCT,
): number | null {
  const perK = cpm * (1 - feePct);
  if (!(perK > 0) || !(targetUsd > 0)) return null;
  return Math.ceil((targetUsd / perK) * 1000);
}

/** Public profile link for a posting account, or null for platforms without a known pattern. */
export function profileUrl(platform: string, handle: string): string | null {
  const h = encodeURIComponent(handle.replace(/^@/, "").trim());
  if (!h) return null;
  switch (platform) {
    case "tiktok":
      return `https://www.tiktok.com/@${h}`;
    case "instagram":
      return `https://www.instagram.com/${h}`;
    case "youtube":
      return `https://www.youtube.com/@${h}`;
    case "x":
      return `https://x.com/${h}`;
    default:
      return null;
  }
}

function sameSource(asset: string, url: string): boolean {
  const norm = (s: string) =>
    s
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  const a = norm(asset);
  const u = norm(url);
  return u === a || u.startsWith(a + "/") || u.startsWith(a + "?") || u.startsWith(a + "&");
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
