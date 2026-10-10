import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ownerStatusFn, claimOwnerFn } from "@/lib/auth/owner.functions";
import { useSignOut } from "@/lib/auth/use-sign-out";
import { AppShell } from "@/components/nav/AppShell";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/login" });
    return { user: data.user };
  },
  component: OwnerGate,
});

function OwnerGate() {
  const getStatus = useServerFn(ownerStatusFn);
  const claim = useServerFn(claimOwnerFn);
  const signOut = useSignOut();
  const [msg, setMsg] = useState("");
  const q = useQuery({ queryKey: ["owner-status"], queryFn: () => getStatus() });

  if (q.isLoading) {
    return <div className="min-h-screen grid place-items-center text-xs tracking-[0.3em] text-neon font-mono">VERIFYING ACCESS...</div>;
  }
  if (q.data?.isOwner) {
    return (
      <AppShell>
        <Outlet />
      </AppShell>
    );
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="panel rounded-lg p-6 max-w-sm w-full text-center space-y-4 font-mono">
        <h1 className="text-neon font-display text-xl tracking-[0.3em]">NOT AUTHORIZED</h1>
        <div className="flex flex-col gap-2">
          {q.data?.canClaim && (
            <button
              onClick={async () => {
                try { await claim(); await q.refetch(); } catch { setMsg("Not authorized"); }
              }}
              className="rounded border border-border bg-terminal px-4 py-2 text-xs tracking-widest text-gold"
            >CLAIM OWNERSHIP</button>
          )}
          <button onClick={signOut} className="rounded border border-border bg-terminal px-4 py-2 text-xs tracking-widest text-neon">SIGN OUT</button>
        </div>
        {msg && <p className="text-xs text-destructive">{msg}</p>}
      </div>
    </div>
  );
}
