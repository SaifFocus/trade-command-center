import {
  Banknote,
  Bot,
  Clapperboard,
  Crosshair,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Megaphone,
  MonitorDot,
  Radar,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavBadge = "approvals" | "lowBudget";

type NavItemBase = {
  label: string;
  icon: LucideIcon;
  badge?: NavBadge;
  /** Extra words the command palette matches on. */
  keywords?: string;
};

/** A page inside APEX. */
export type RouteNavItem = NavItemBase & {
  to:
    | "/"
    | "/desk"
    | "/fx"
    | "/backtest"
    | "/scout"
    | "/agents"
    | "/rewards"
    | "/rewards/campaigns"
    | "/rewards/pipeline"
    | "/rewards/approvals"
    | "/rewards/agents"
    | "/rewards/earnings"
    | "/rewards/accounts";
  /** Active only on this exact path (for section roots like / and /rewards). */
  exact?: boolean;
  href?: never;
};

/** A page outside APEX, opened in a new tab (never active). */
export type LinkNavItem = NavItemBase & { href: string; to?: never; exact?: never };

export type NavItem = RouteNavItem | LinkNavItem;

export const isExternal = (item: NavItem): item is LinkNavItem => typeof item.href === "string";
export const navKey = (item: NavItem) => (isExternal(item) ? item.href : item.to);

export type NavGroup = { label: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Trading",
    items: [
      {
        to: "/",
        label: "Dashboard",
        icon: LayoutDashboard,
        exact: true,
        keywords: "home portfolio markets",
      },
      { to: "/desk", label: "Desk", icon: Crosshair, keywords: "paper live signals positions" },
      { to: "/fx", label: "FX Desk", icon: Banknote, keywords: "forex fx eur jpy gbp gold silver sprint steady paper" },
      { to: "/backtest", label: "Backtest", icon: FlaskConical, keywords: "history runs" },
      { to: "/scout", label: "Scout", icon: Radar, keywords: "smart money wallets invo copy" },
      { to: "/agents", label: "Agents", icon: Bot, keywords: "trading agents jobs schedule runs log status bridge" },
      {
        // The owner's private Claude dashboard (claude.ai login required); opens in a new tab.
        href: "https://claude.ai/artifact/1MPnjdb7L8FfowkzfspCrR",
        label: "Control Room",
        icon: MonitorDot,
        keywords: "apex control room claude dashboard status",
      },
    ],
  },
  {
    label: "Content Rewards",
    items: [
      {
        to: "/rewards",
        label: "Overview",
        icon: Gauge,
        exact: true,
        keywords: "whop clipping kpi",
      },
      {
        to: "/rewards/campaigns",
        label: "Campaigns",
        icon: Megaphone,
        badge: "lowBudget",
        keywords: "whop cpm budget",
      },
      {
        to: "/rewards/pipeline",
        label: "Clip Pipeline",
        icon: Clapperboard,
        keywords: "kanban clips stages",
      },
      {
        to: "/rewards/approvals",
        label: "Approvals",
        icon: ShieldCheck,
        badge: "approvals",
        keywords: "review queue",
      },
      { to: "/rewards/agents", label: "Agents", icon: Bot, keywords: "autonomy runs log" },
      { to: "/rewards/earnings", label: "Earnings", icon: Wallet, keywords: "views payouts money" },
      {
        to: "/rewards/accounts",
        label: "Accounts",
        icon: Users,
        keywords: "tiktok instagram youtube social",
      },
    ],
  },
];

export function isActive(item: NavItem, pathname: string): boolean {
  if (isExternal(item)) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (item.exact) return path === item.to;
  return path === item.to || path.startsWith(`${item.to}/`);
}
