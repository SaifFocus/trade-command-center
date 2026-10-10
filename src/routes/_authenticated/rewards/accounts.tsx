import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ExternalLink, Link2, Pencil, Plus, ShieldAlert, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Button,
  Chip,
  EmptyState,
  Kpi,
  LoadState,
  PageShell,
  Panel,
  ago,
  compact,
  errText,
  inputCls,
} from "@/components/rewards/kit";
import { saveAccountFn } from "@/lib/cr/cr.functions";
import { ACCOUNT_STATUSES, PLATFORMS, PLATFORM_LABEL, profileUrl } from "@/lib/cr/logic";
import { useAccounts, usePosts, useRefreshCr, type Account } from "@/lib/cr/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/rewards/accounts")({
  head: () => ({
    meta: [
      { title: "APEX — Accounts" },
      { name: "description", content: "Social accounts that post Content Rewards clips." },
    ],
  }),
  component: AccountsPage,
});

const STATUS_TONE: Record<string, "neon" | "gold" | "danger" | "muted"> = {
  active: "neon",
  warming: "gold",
  restricted: "danger",
  banned: "danger",
};

const RULES = [
  "Link every account in Content Rewards before its first post, or its views won't count.",
  "Instagram accounts must be Professional or Creator accounts to link.",
  "Warm up new accounts with normal use before posting clips.",
  "One variant per account: never the same file on two accounts.",
  "Space posts 30–90 minutes apart on each account.",
  "Submit each post link within 30 minutes of posting.",
  "Paid-partnership / disclosure toggle on for every clip.",
  "Never buy views, join engagement pods or run giveaways for views.",
];

function AccountsPage() {
  const accounts = useAccounts();
  const posts = usePosts();
  const refresh = useRefreshCr();
  const [form, setForm] = useState<{ open: boolean; account: Account | null }>({
    open: false,
    account: null,
  });
  const list = accounts.data ?? [];

  const usage = useMemo(() => {
    const m = new Map<
      string,
      { posts: number; views: number; last: string | null; denied: number }
    >();
    for (const p of posts.data ?? []) {
      if (!p.account_id) continue;
      const u = m.get(p.account_id) ?? { posts: 0, views: 0, last: null, denied: 0 };
      u.posts += 1;
      u.views += p.views_current;
      if (p.submission_status === "denied") u.denied += 1;
      if (p.posted_at && (!u.last || p.posted_at > u.last)) u.last = p.posted_at;
      m.set(p.account_id, u);
    }
    return m;
  }, [posts.data]);

  const counts = {
    active: list.filter((a) => a.status === "active").length,
    warming: list.filter((a) => a.status === "warming").length,
    trouble: list.filter((a) => a.status === "restricted" || a.status === "banned"),
    linked: list.filter((a) => a.linked_in_whop).length,
  };
  const grouped = PLATFORMS.map((p) => ({
    platform: p,
    items: list.filter((a) => a.platform === p),
  })).filter((g) => g.items.length > 0);
  const openForm = (account: Account | null) => setForm({ open: true, account });

  return (
    <PageShell
      title="ACCOUNTS"
      subtitle="The social accounts that post clips. Keeping them clean protects every pending payout."
      actions={
        <Button tone="gold" onClick={() => openForm(null)}>
          <Plus className="size-3.5" /> ADD ACCOUNT
        </Button>
      }
    >
      <LoadState loading={accounts.isLoading} error={accounts.error} />

      {counts.trouble.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-destructive/60 bg-[color-mix(in_oklab,var(--destructive)_8%,transparent)] px-4 py-3 text-xs">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
          <div>
            <div className="tracking-[0.2em] text-destructive">ACCOUNT TROUBLE</div>
            <p className="mt-1 text-muted-foreground">
              {counts.trouble
                .map(
                  (a) => `${PLATFORM_LABEL[a.platform] ?? a.platform} @${a.handle} (${a.status})`,
                )
                .join(", ")}
              . Pause the Publisher for these accounts and find the cause before posting again.
            </p>
          </div>
        </div>
      )}

      {list.length > 0 && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi
            label="ACCOUNTS"
            value={list.length}
            sub={`${grouped.length} platform${grouped.length === 1 ? "" : "s"}`}
          />
          <Kpi label="ACTIVE" value={counts.active} sub="ready to post" tone="neon" />
          <Kpi label="WARMING UP" value={counts.warming} sub="not posting clips yet" tone="gold" />
          <Kpi
            label="LINKED IN CR"
            value={`${counts.linked}/${list.length}`}
            sub={counts.linked < list.length ? "unlinked accounts don't earn" : "all linked"}
            tone={counts.linked < list.length ? "danger" : "neon"}
          />
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {!accounts.isLoading && list.length === 0 ? (
            <EmptyState
              icon={Users}
              title="NO ACCOUNTS YET"
              body="Link your TikTok, Instagram and YouTube accounts in Content Rewards first, then add them here so the Publisher knows where each clip may go."
              action={
                <Button tone="gold" onClick={() => openForm(null)}>
                  <Plus className="size-3.5" /> ADD ACCOUNT
                </Button>
              }
            />
          ) : (
            grouped.map((g) => (
              <Panel
                key={g.platform}
                title={(PLATFORM_LABEL[g.platform] ?? g.platform).toUpperCase()}
                right={<span className="text-[11px] text-muted-foreground">{g.items.length}</span>}
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] table-fixed text-xs">
                    <colgroup>
                      <col className="w-[32%]" />
                      <col className="w-[14%]" />
                      <col className="w-[16%]" />
                      <col className="w-[9%]" />
                      <col className="w-[10%]" />
                      <col className="w-[13%]" />
                      <col className="w-[6%]" />
                    </colgroup>
                    <thead className="text-left text-[10px] tracking-widest text-muted-foreground">
                      <tr>
                        <th className="py-1 pr-3 font-normal">HANDLE</th>
                        <th className="py-1 pr-3 font-normal">STATUS</th>
                        <th className="py-1 pr-3 font-normal">LINKED</th>
                        <th className="py-1 pr-3 text-right font-normal">POSTS</th>
                        <th className="py-1 pr-3 text-right font-normal">VIEWS</th>
                        <th className="py-1 pr-3 font-normal">LAST POST</th>
                        <th className="py-1 font-normal">
                          <span className="sr-only">Edit</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((a) => {
                        const u = usage.get(a.id);
                        const url = profileUrl(a.platform, a.handle);
                        return (
                          <tr key={a.id} className="border-t border-border/50 align-top">
                            <td className="py-2 pr-3">
                              {url ? (
                                <a
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-foreground hover:text-neon"
                                >
                                  @{a.handle} <ExternalLink className="size-3" />
                                </a>
                              ) : (
                                <span className="text-foreground">@{a.handle}</span>
                              )}
                              {a.notes && (
                                <div
                                  className="mt-0.5 max-w-[260px] truncate text-[11px] text-muted-foreground"
                                  title={a.notes}
                                >
                                  {a.notes}
                                </div>
                              )}
                            </td>
                            <td className="py-2 pr-3">
                              <Chip tone={STATUS_TONE[a.status] ?? "muted"}>{a.status}</Chip>
                            </td>
                            <td className="py-2 pr-3">
                              {a.linked_in_whop ? (
                                <Chip tone="neon">
                                  <Link2 className="size-3" /> linked
                                </Chip>
                              ) : (
                                <Chip tone="danger">
                                  <AlertTriangle className="size-3" /> not linked
                                </Chip>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums">
                              {u?.posts ?? 0}
                              {u && u.denied > 0 && (
                                <div className="text-[10px] text-destructive">
                                  {u.denied} denied
                                </div>
                              )}
                            </td>
                            <td className="py-2 pr-3 text-right tabular-nums text-[var(--color-usstocks)]">
                              {compact(u?.views ?? 0)}
                            </td>
                            <td className="whitespace-nowrap py-2 pr-3 text-muted-foreground">
                              {ago(u?.last)}
                            </td>
                            <td className="py-2 text-right">
                              <button
                                type="button"
                                onClick={() => openForm(a)}
                                aria-label={`Edit @${a.handle}`}
                                className="grid size-7 place-items-center rounded border border-border text-muted-foreground hover:border-[var(--neon)] hover:text-neon"
                              >
                                <Pencil className="size-3" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Panel>
            ))
          )}
        </div>

        <Panel title="POSTING RULES">
          <ul className="space-y-2">
            {RULES.map((r) => (
              <li key={r} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--neon)]" />
                {r}
              </li>
            ))}
          </ul>
          <p className="mt-3 border-t border-border/50 pt-3 text-[11px] leading-relaxed text-muted-foreground">
            A Content Rewards ban can blacklist the linked accounts and forfeit every pending
            payout, so a flagged account stops all posting until you clear it.
          </p>
        </Panel>
      </div>

      {form.open && (
        <AccountForm
          key={form.account?.id ?? "new"}
          account={form.account}
          onOpenChange={(o) => setForm((f) => ({ ...f, open: o }))}
          onSaved={refresh}
        />
      )}
    </PageShell>
  );
}

function AccountForm({
  account,
  onOpenChange,
  onSaved,
}: {
  account: Account | null;
  onOpenChange: (o: boolean) => void;
  onSaved: () => void;
}) {
  const save = useServerFn(saveAccountFn);
  const [platform, setPlatform] = useState(account?.platform ?? "tiktok");
  const [handle, setHandle] = useState(account?.handle ?? "");
  const [status, setStatus] = useState(account?.status ?? "warming");
  const [linked, setLinked] = useState(account?.linked_in_whop ?? false);
  const [notes, setNotes] = useState(account?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    const h = handle.trim().replace(/^@/, "");
    if (!h) {
      setError("Add the account handle.");
      return;
    }
    setBusy(true);
    try {
      await save({
        data: {
          id: account?.id,
          platform: platform as (typeof PLATFORMS)[number],
          handle: h,
          status: status as (typeof ACCOUNT_STATUSES)[number],
          linked_in_whop: linked,
          notes: notes.trim() || null,
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
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="panel max-w-md font-mono">
        <DialogHeader>
          <DialogTitle className="text-neon font-display tracking-[0.2em]">
            {account ? "EDIT ACCOUNT" : "ADD ACCOUNT"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Add accounts after linking them in Content Rewards. New accounts start as warming up.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] tracking-[0.25em] text-muted-foreground">PLATFORM</span>
            <select
              className={inputCls}
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] tracking-[0.25em] text-muted-foreground">HANDLE *</span>
            <input
              className={inputCls}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="@handle"
              autoFocus
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] tracking-[0.25em] text-muted-foreground">STATUS</span>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              {ACCOUNT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-end gap-2 pb-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={linked}
              onChange={(e) => setLinked(e.target.checked)}
              className="accent-[var(--neon)]"
            />
            Linked in Content Rewards
          </label>
          <label className="col-span-2 flex flex-col gap-1">
            <span className="text-[10px] tracking-[0.25em] text-muted-foreground">NOTES</span>
            <textarea
              className={cn(inputCls, "min-h-14")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Niche, warm-up start date, anything the Publisher should know"
            />
          </label>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button tone="muted" onClick={() => onOpenChange(false)}>
            CANCEL
          </Button>
          <Button tone="gold" onClick={submit} disabled={busy}>
            {busy ? "SAVING…" : account ? "SAVE CHANGES" : "ADD ACCOUNT"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
