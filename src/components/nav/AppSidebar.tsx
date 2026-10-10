import { Link, useRouterState } from "@tanstack/react-router";
import { Command as CommandIcon, LogOut, PanelLeft } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@/components/ui/sidebar";
import { useSignOut } from "@/lib/auth/use-sign-out";
import { useDeskMode, useNavCounts } from "@/lib/cr/queries";
import { cn } from "@/lib/utils";
import { NAV_GROUPS, isActive, type NavBadge } from "./nav-config";

const MOD_KEY =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.userAgent) ? "⌘" : "Ctrl ";

const itemClass = cn(
  "relative h-9 font-mono text-[11px] uppercase tracking-[0.18em] text-sidebar-foreground/80",
  "hover:bg-sidebar-accent hover:text-foreground",
  "data-[active=true]:bg-[color-mix(in_oklab,var(--neon)_10%,transparent)] data-[active=true]:text-neon data-[active=true]:font-semibold",
  "data-[active=true]:before:absolute data-[active=true]:before:inset-y-1 data-[active=true]:before:left-0 data-[active=true]:before:w-[2px] data-[active=true]:before:rounded-full data-[active=true]:before:bg-[var(--neon)] data-[active=true]:before:shadow-[0_0_8px_var(--neon)]",
);

export function AppSidebar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { toggleSidebar, state, isMobile, setOpenMobile } = useSidebar();
  const counts = useNavCounts();
  const mode = useDeskMode();
  const signOut = useSignOut();
  const collapsed = state === "collapsed" && !isMobile;

  const badgeFor = (b?: NavBadge) => (b ? (counts.data?.[b] ?? 0) : 0);
  const close = () => isMobile && setOpenMobile(false);
  const live = mode.data?.liveArmed === true;

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="border-b border-sidebar-border px-2 py-3">
        <div className="flex items-center justify-between gap-2">
          <Link
            to="/"
            onClick={close}
            className={cn("flex min-w-0 flex-col pl-1", collapsed && "hidden")}
          >
            <span className="text-neon font-display text-lg font-black leading-none tracking-[0.25em]">
              APEX
            </span>
            <span className="mt-1 truncate text-[9px] tracking-[0.35em] text-muted-foreground">
              COMMAND CENTER
            </span>
          </Link>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            title={collapsed ? "Expand menu (Ctrl/Cmd+B)" : "Collapse menu (Ctrl/Cmd+B)"}
            className="grid size-8 shrink-0 place-items-center rounded border border-sidebar-border text-muted-foreground transition-colors hover:border-[var(--neon)] hover:text-neon"
          >
            <PanelLeft className="size-4" />
          </button>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0 py-2">
        <SidebarMenu className="px-2 pb-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={onOpenPalette}
              tooltip="Jump to… (Ctrl/Cmd+K)"
              className="h-9 border border-dashed border-sidebar-border font-mono text-[11px] tracking-[0.15em] text-muted-foreground hover:text-neon"
            >
              <CommandIcon />
              <span>JUMP TO…</span>
              <kbd className="ml-auto rounded border border-sidebar-border px-1.5 py-0.5 text-[9px] text-muted-foreground group-data-[collapsible=icon]:hidden">
                {MOD_KEY}K
              </kbd>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel className="h-7 font-mono text-[9px] uppercase tracking-[0.4em] text-muted-foreground/70">
              {group.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => {
                  const active = isActive(item, pathname);
                  const count = badgeFor(item.badge);
                  const Icon = item.icon;
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={count > 0 ? `${item.label} · ${count}` : item.label}
                        className={itemClass}
                      >
                        <Link to={item.to} onClick={close}>
                          <Icon className={cn(active ? "text-neon" : "text-muted-foreground")} />
                          <span>{item.label}</span>
                          {collapsed && count > 0 && (
                            <span
                              aria-hidden="true"
                              className={cn(
                                "absolute right-1 top-1 size-1.5 rounded-full",
                                item.badge === "lowBudget" ? "bg-destructive" : "bg-[var(--gold)]",
                              )}
                            />
                          )}
                        </Link>
                      </SidebarMenuButton>
                      {count > 0 && (
                        <SidebarMenuBadge
                          className={cn(
                            "rounded border px-1.5 font-mono text-[10px]",
                            item.badge === "lowBudget"
                              ? "border-destructive/60 text-destructive"
                              : "border-[color-mix(in_oklab,var(--gold)_60%,transparent)] text-gold",
                          )}
                          aria-label={
                            item.badge === "lowBudget"
                              ? `${count} campaigns low on budget`
                              : `${count} clips waiting`
                          }
                        >
                          {count}
                        </SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarSeparator className="mx-0" />
      <SidebarFooter className="gap-1 px-2 py-3">
        <div
          className="flex items-center gap-2 rounded border border-sidebar-border bg-terminal px-2 py-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
          title={live ? "Live trading is armed" : "Paper mode: no real money"}
        >
          <span className="relative flex size-2 shrink-0">
            <span
              className={cn(
                "absolute inline-flex size-full rounded-full opacity-60 pulse-dot",
                live ? "bg-[var(--gold)]" : "bg-[var(--neon)]",
              )}
            />
            <span
              className={cn(
                "relative inline-flex size-2 rounded-full",
                live ? "bg-[var(--gold)]" : "bg-[var(--neon)]",
              )}
            />
          </span>
          <div className="min-w-0 leading-tight group-data-[collapsible=icon]:hidden">
            <div className={cn("text-[10px] tracking-[0.25em]", live ? "text-gold" : "text-neon")}>
              {live ? "LIVE ARMED" : "PAPER MODE"}
            </div>
            <div className="text-[9px] tracking-[0.25em] text-muted-foreground">SYSTEM ONLINE</div>
          </div>
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={signOut}
              tooltip="Sign out"
              className={cn(itemClass, "hover:text-destructive")}
            >
              <LogOut className="text-muted-foreground" />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
