import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { Command as CommandIcon, Menu } from "lucide-react";
import { SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "./AppSidebar";
import { CommandPalette } from "./CommandPalette";

const STORAGE_KEY = "apex.sidebar.open";

function readOpen(): boolean {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v == null ? true : v === "1";
  } catch {
    return true;
  }
}

function MobileBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { setOpenMobile } = useSidebar();
  return (
    <div className="panel sticky top-0 z-20 flex items-center justify-between border-b px-4 py-2 md:hidden">
      <Button
        variant="outline"
        size="icon"
        type="button"
        onClick={() => setOpenMobile(true)}
        aria-label="Open menu"
        className="grid size-9 place-items-center rounded border border-border bg-terminal text-neon"
      >
        <Menu className="size-4" />
      </Button>
      <Link to="/" className="text-neon font-display text-lg font-black tracking-[0.25em]">
        APEX
      </Link>
      <Button
        variant="outline"
        size="icon"
        type="button"
        onClick={onOpenPalette}
        aria-label="Jump to a page"
        className="grid size-9 place-items-center rounded border border-border bg-terminal text-muted-foreground"
      >
        <CommandIcon className="size-4" />
      </Button>
    </div>
  );
}

/** Sidebar + command palette around every signed-in page. */
export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(true);
  useEffect(() => setOpen(readOpen()), []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);

  const onOpenChange = (v: boolean) => {
    setOpen(v);
    try {
      window.localStorage.setItem(STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* storage unavailable: state just isn't remembered */
    }
  };

  return (
    <SidebarProvider open={open} onOpenChange={onOpenChange}>
      <AppSidebar onOpenPalette={openPalette} />
      <div className="relative flex min-h-svh min-w-0 flex-1 flex-col">
        <MobileBar onOpenPalette={openPalette} />
        {children}
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </SidebarProvider>
  );
}
