import { useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveCampaignFn } from "@/lib/cr/cr.functions";
import { CAMPAIGN_STATUSES, PLATFORMS, PLATFORM_LABEL } from "@/lib/cr/logic";
import type { Campaign } from "@/lib/cr/queries";
import { cn } from "@/lib/utils";
import { Button, errText, inputCls } from "./kit";

type Form = Record<string, string> & { platforms: string; disclosure: string };

const num = (s: string) => {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const words = (s: string) =>
  s
    .split(/[\s,]+/)
    .map((w) => w.trim())
    .filter(Boolean);
const lines = (s: string) =>
  s
    .split(/\n+/)
    .map((w) => w.trim())
    .filter(Boolean);

function toForm(c?: Campaign | null): Form {
  const v = (x: unknown) => (x == null ? "" : String(x));
  return {
    whop_url: v(c?.whop_url),
    title: v(c?.title),
    brand: v(c?.brand),
    category: c?.category ?? "clipping",
    status: c?.status ?? "watching",
    rate_per_1k_usd: v(c?.rate_per_1k_usd),
    budget_total_usd: v(c?.budget_total_usd),
    budget_remaining_usd: v(c?.budget_remaining_usd),
    min_payout_usd: v(c?.min_payout_usd),
    max_payout_usd: v(c?.max_payout_usd),
    flat_fee_usd: v(c?.flat_fee_usd),
    min_length_s: v(c?.min_length_s),
    max_length_s: v(c?.max_length_s),
    required_hashtags: (c?.required_hashtags ?? []).join(" "),
    required_credit: v(c?.required_credit),
    source_assets: (c?.source_assets ?? []).join("\n"),
    prohibited: v(c?.prohibited),
    deadline: c?.deadline ? c.deadline.slice(0, 10) : "",
    score: v(c?.score),
    notes: v(c?.notes),
    platforms: (c?.platforms ?? []).join(","),
    disclosure: c?.disclosure_required ? "1" : "",
  };
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="text-[10px] tracking-[0.25em] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function CampaignForm({
  open,
  onOpenChange,
  campaign,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign?: Campaign | null;
  onSaved: () => void;
}) {
  const save = useServerFn(saveCampaignFn);
  const [f, setF] = useState<Form>(() => toForm(campaign));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string) => (e: { target: { value: string } }) =>
    setF((p) => ({ ...p, [k]: e.target.value }));
  const platforms = f.platforms ? f.platforms.split(",") : [];

  const togglePlatform = (p: string) =>
    setF((prev) => {
      const cur = prev.platforms ? prev.platforms.split(",") : [];
      const next = cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p];
      return { ...prev, platforms: next.join(",") };
    });

  const submit = async () => {
    setError("");
    const url = f.whop_url.trim();
    if (!/^https?:\/\//i.test(url)) {
      setError("Paste the full campaign link (https://…).");
      return;
    }
    const total = num(f.budget_total_usd);
    const remaining = num(f.budget_remaining_usd);
    if (total != null && remaining != null && remaining > total) {
      setError("Budget remaining can't be more than the total budget.");
      return;
    }
    setBusy(true);
    try {
      await save({
        data: {
          id: campaign?.id,
          whop_url: url,
          title: f.title.trim() || null,
          brand: f.brand.trim() || null,
          category: f.category as "clipping" | "ugc" | "other",
          status: f.status as (typeof CAMPAIGN_STATUSES)[number],
          rate_per_1k_usd: num(f.rate_per_1k_usd),
          budget_total_usd: total,
          budget_remaining_usd: remaining,
          min_payout_usd: num(f.min_payout_usd),
          max_payout_usd: num(f.max_payout_usd),
          flat_fee_usd: num(f.flat_fee_usd),
          min_length_s:
            num(f.min_length_s) == null ? null : Math.round(num(f.min_length_s) as number),
          max_length_s:
            num(f.max_length_s) == null ? null : Math.round(num(f.max_length_s) as number),
          platforms: platforms as (typeof PLATFORMS)[number][],
          required_hashtags: words(f.required_hashtags),
          required_credit: f.required_credit.trim() || null,
          disclosure_required: f.disclosure === "1",
          source_assets: lines(f.source_assets),
          prohibited: f.prohibited.trim() || null,
          deadline: f.deadline ? new Date(`${f.deadline}T23:59:59Z`).toISOString() : null,
          score: f.score ? Number(f.score) : null,
          notes: f.notes.trim() || null,
        },
      });
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="panel max-h-[90vh] max-w-2xl overflow-y-auto font-mono">
        <DialogHeader>
          <DialogTitle className="text-neon font-display tracking-[0.2em]">
            {campaign ? "EDIT CAMPAIGN" : "ADD CAMPAIGN"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Copy the numbers from the campaign page on Content Rewards. Only the link is required;
            the Brief Parser agent can fill the rest.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="CAMPAIGN LINK *" className="sm:col-span-2">
            <input
              className={inputCls}
              value={f.whop_url}
              onChange={set("whop_url")}
              placeholder="https://contentrewards.com/c/campaigns/…"
              autoFocus
            />
          </Field>
          <Field label="TITLE">
            <input className={inputCls} value={f.title} onChange={set("title")} />
          </Field>
          <Field label="BRAND / CREATOR">
            <input className={inputCls} value={f.brand} onChange={set("brand")} />
          </Field>
          <Field label="CATEGORY">
            <select className={inputCls} value={f.category} onChange={set("category")}>
              <option value="clipping">Clipping</option>
              <option value="ugc">UGC</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="STATUS">
            <select className={inputCls} value={f.status} onChange={set("status")}>
              {CAMPAIGN_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-3 gap-3 sm:col-span-2">
            <Field label="RATE / 1K VIEWS ($)">
              <input
                className={inputCls}
                inputMode="decimal"
                value={f.rate_per_1k_usd}
                onChange={set("rate_per_1k_usd")}
              />
            </Field>
            <Field label="BUDGET TOTAL ($)">
              <input
                className={inputCls}
                inputMode="decimal"
                value={f.budget_total_usd}
                onChange={set("budget_total_usd")}
              />
            </Field>
            <Field label="BUDGET LEFT ($)">
              <input
                className={inputCls}
                inputMode="decimal"
                value={f.budget_remaining_usd}
                onChange={set("budget_remaining_usd")}
              />
            </Field>
            <Field label="MIN PAYOUT ($)">
              <input
                className={inputCls}
                inputMode="decimal"
                value={f.min_payout_usd}
                onChange={set("min_payout_usd")}
              />
            </Field>
            <Field label="MAX PAYOUT ($)">
              <input
                className={inputCls}
                inputMode="decimal"
                value={f.max_payout_usd}
                onChange={set("max_payout_usd")}
              />
            </Field>
            <Field label="FLAT FEE ($)">
              <input
                className={inputCls}
                inputMode="decimal"
                value={f.flat_fee_usd}
                onChange={set("flat_fee_usd")}
              />
            </Field>
          </div>

          <Field label="PLATFORMS" className="sm:col-span-2">
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={cn(
                    "rounded border px-2 py-1 text-[11px] tracking-wider",
                    platforms.includes(p)
                      ? "border-[var(--neon)] text-neon"
                      : "border-border text-muted-foreground",
                  )}
                  aria-pressed={platforms.includes(p)}
                >
                  {PLATFORM_LABEL[p]}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-3 gap-3 sm:col-span-2">
            <Field label="MIN LENGTH (S)">
              <input
                className={inputCls}
                inputMode="numeric"
                value={f.min_length_s}
                onChange={set("min_length_s")}
              />
            </Field>
            <Field label="MAX LENGTH (S)">
              <input
                className={inputCls}
                inputMode="numeric"
                value={f.max_length_s}
                onChange={set("max_length_s")}
              />
            </Field>
            <Field label="DEADLINE">
              <input
                type="date"
                className={inputCls}
                value={f.deadline}
                onChange={set("deadline")}
              />
            </Field>
          </div>

          <Field label="REQUIRED HASHTAGS">
            <input
              className={inputCls}
              value={f.required_hashtags}
              onChange={set("required_hashtags")}
              placeholder="#brand #ad"
            />
          </Field>
          <Field label="REQUIRED CREDIT">
            <input
              className={inputCls}
              value={f.required_credit}
              onChange={set("required_credit")}
              placeholder="@creator in caption"
            />
          </Field>
          <Field label="SOURCE ASSETS (ONE LINK PER LINE)" className="sm:col-span-2">
            <textarea
              className={cn(inputCls, "min-h-16")}
              value={f.source_assets}
              onChange={set("source_assets")}
            />
          </Field>
          <Field label="BANNED / PROHIBITED" className="sm:col-span-2">
            <textarea
              className={cn(inputCls, "min-h-14")}
              value={f.prohibited}
              onChange={set("prohibited")}
            />
          </Field>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={f.disclosure === "1"}
              onChange={(e) => setF((p) => ({ ...p, disclosure: e.target.checked ? "1" : "" }))}
              className="accent-[var(--neon)]"
            />
            Disclosure / paid-partnership toggle required
          </label>
          <Field label="SCORE (1–5)">
            <select className={inputCls} value={f.score} onChange={set("score")}>
              <option value="">Not scored</option>
              {[5, 4, 3, 2, 1].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="NOTES" className="sm:col-span-2">
            <textarea
              className={cn(inputCls, "min-h-14")}
              value={f.notes}
              onChange={set("notes")}
            />
          </Field>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button tone="muted" onClick={() => onOpenChange(false)}>
            CANCEL
          </Button>
          <Button tone="gold" onClick={submit} disabled={busy}>
            {busy ? "SAVING…" : campaign ? "SAVE CHANGES" : "ADD CAMPAIGN"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
