import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// Shared building blocks for the /rewards pages, in the APEX terminal style.

export function PageShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="panel border-b">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div className="min-w-0">
            <div className="text-[10px] tracking-[0.4em] text-muted-foreground">
              CONTENT REWARDS
            </div>
            <h1 className="text-neon font-display text-2xl font-black tracking-[0.2em]">{title}</h1>
            {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] space-y-4 px-6 py-6">{children}</main>
    </div>
  );
}

export function Panel({
  title,
  right,
  children,
  className,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("panel rounded-lg p-4", className)}>
      {(title || right) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-xs tracking-[0.3em] text-neon">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "neon" | "gold" | "muted" | "danger" | "cyan";

const TONE_TEXT: Record<Tone, string> = {
  neon: "text-neon",
  gold: "text-gold",
  muted: "text-foreground",
  danger: "text-destructive",
  cyan: "text-[var(--color-usstocks)]",
};

export function Kpi({
  label,
  value,
  sub,
  tone = "muted",
  to,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  to?: "/rewards/approvals" | "/rewards/campaigns" | "/rewards/earnings" | "/rewards/pipeline";
}) {
  const body = (
    <>
      <div className="text-[10px] tracking-[0.3em] text-muted-foreground">{label}</div>
      <div className={cn("mt-1 font-display text-2xl font-bold tabular-nums", TONE_TEXT[tone])}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-muted-foreground">{sub}</div>}
    </>
  );
  const cls = "panel block rounded-lg p-4";
  return to ? (
    <Link to={to} className={cn(cls, "transition-colors hover:border-[var(--neon)]")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

const CHIP_TONE: Record<Tone, string> = {
  neon: "border-[color-mix(in_oklab,var(--neon)_50%,transparent)] text-neon",
  gold: "border-[color-mix(in_oklab,var(--gold)_55%,transparent)] text-gold",
  muted: "border-border text-muted-foreground",
  danger: "border-destructive/60 text-destructive",
  cyan: "border-[color-mix(in_oklab,var(--color-usstocks)_50%,transparent)] text-[var(--color-usstocks)]",
};

export function Chip({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
        CHIP_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ status }: { status: string | null | undefined }) {
  const color =
    status === "ok"
      ? "bg-[var(--neon)]"
      : status === "warning"
        ? "bg-[var(--gold)]"
        : status === "error"
          ? "bg-destructive"
          : "bg-muted-foreground/40";
  const label = status ? status.toUpperCase() : "NEVER RUN";
  return (
    <span
      className="inline-flex items-center gap-1.5 text-[10px] tracking-widest text-muted-foreground"
      title={label}
    >
      <span className={cn("size-2 rounded-full", color)} />
      {label}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      <Icon className="size-8 text-muted-foreground/60" />
      <div className="text-xs tracking-[0.3em] text-neon">{title}</div>
      <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

export function LoadState({ loading, error }: { loading: boolean; error: unknown }) {
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 px-4 py-3 text-xs text-destructive">
        Could not load data: {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="panel rounded-lg px-4 py-3 text-xs tracking-[0.3em] text-neon">LOADING…</div>
    );
  }
  return null;
}

export function Button({
  children,
  onClick,
  tone = "neon",
  disabled,
  type = "button",
  className,
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "neon" | "gold" | "danger" | "muted";
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  title?: string;
}) {
  const tones = {
    neon: "text-neon hover:border-[var(--neon)]",
    gold: "text-gold hover:border-[var(--gold)]",
    danger: "text-destructive hover:border-destructive",
    muted: "text-muted-foreground hover:text-foreground",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded border border-border bg-terminal px-3 py-1.5 text-[11px] tracking-widest transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        tones[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

export const inputCls =
  "w-full rounded border border-border bg-terminal px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-[var(--neon)] focus:outline-none";

// Formatting

export const usd = (n: number | null | undefined, digits = 2) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : `$${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export const int = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : Math.round(n).toLocaleString("en-US");

export const compact = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const when = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleString("sv-SE", { timeZone: "Europe/Stockholm" }).slice(0, 16) : "—";

export const day = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" }) : "—";

export function ago(s: string | null | undefined, now = Date.now()) {
  if (!s) return "—";
  const m = Math.round((now - Date.parse(s)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
