import {
  Bot,
  Clapperboard,
  Crosshair,
  FlaskConical,
  Gauge,
  LayoutDashboard,
  Megaphone,
  Radar,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type NavBadge = "approvals" | "lowBudget";

export type NavItem = {
  to:
    | "/"
    | "/desk"
    | "/backtest"
    | "/scout"
    | "/rewards"
    | "/rewards/campaigns"
    | "/rewards/pipeline"
    | "/rewards/approvals"
    | "/rewards/agents"
    | "/rewards/earnings"
    | "/rewards/accounts";
  label: string;
  icon: LucideIcon;
  /** Active only on this exact path (for section roots like / and /rewards). */
  exact?: boolean;
  badge?: NavBadge;
  /** Extra words the command palette matches on. */
  keywords?: string;
};

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
      { to: "/backtest", label: "Backtest", icon: FlaskConical, keywords: "history runs" },
      { to: "/scout", label: "Scout", icon: Radar, keywords: "smart money wallets invo copy" },
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
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (item.exact) return path === item.to;
  return path === item.to || path.startsWith(`${item.to}/`);
}
