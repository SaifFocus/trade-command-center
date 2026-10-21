import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useSignOut } from "@/lib/auth/use-sign-out";
import { useSidebar } from "@/components/ui/sidebar";
import { NAV_GROUPS, isExternal, navKey } from "./nav-config";

/** Ctrl/Cmd+K jump menu over every page in the sidebar. */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { setOpenMobile } = useSidebar();
  const signOut = useSignOut();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  const run = (fn: () => void) => {
    onOpenChange(false);
    setOpenMobile(false);
    fn();
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Jump to a page…" className="font-mono text-sm" />
      <CommandList className="font-mono">
        <CommandEmpty>No page matches.</CommandEmpty>
        {NAV_GROUPS.map((group, i) => (
          <div key={group.label}>
            {i > 0 && <CommandSeparator />}
            <CommandGroup heading={group.label.toUpperCase()}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={navKey(item)}
                    value={`${group.label} ${item.label} ${item.keywords ?? ""}`}
                    onSelect={() =>
                      run(() =>
                        isExternal(item)
                          ? void window.open(item.href, "_blank", "noopener,noreferrer")
                          : void navigate({ to: item.to }),
                      )
                    }
                    className="gap-2 text-xs tracking-wider"
                  >
                    <Icon className="size-4 text-neon" />
                    <span>{item.label}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {isExternal(item) ? "new tab ↗" : item.to}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </div>
        ))}
        <CommandSeparator />
        <CommandGroup heading="SESSION">
          <CommandItem
            value="sign out log out"
            onSelect={() => run(() => void signOut())}
            className="gap-2 text-xs tracking-wider"
          >
            <LogOut className="size-4 text-muted-foreground" />
            <span>Sign out</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
