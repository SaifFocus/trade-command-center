import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { ownerExistsFn } from "@/lib/auth/owner.functions";

export const Route = createFileRoute("/login")({
  ssr: false,
  head: () => ({ meta: [{ title: "Sign in — APEX" }, { name: "description", content: "Private access." }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const ownerExists = useServerFn(ownerExistsFn);
  const q = useQuery({ queryKey: ["owner-exists"], queryFn: () => ownerExists() });
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const canSignUp = q.data?.ownerExists === false;

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => { if (data.user) navigate({ to: "/", replace: true }); });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setMsg("");
    if (mode === "up" && canSignUp) {
      const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
      setMsg(error ? error.message : "Check your inbox to confirm your email, then sign in.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMsg(error.message); else navigate({ to: "/", replace: true });
    }
    setBusy(false);
  };

  const google = async () => {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (r.error) { setMsg("Google sign-in failed"); return; }
    if (r.redirected) return;
    navigate({ to: "/", replace: true });
  };

  const input = "w-full rounded border border-border bg-terminal px-3 py-2 text-sm text-foreground outline-none focus:border-neon";
  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="panel rounded-lg p-6 max-w-sm w-full space-y-4 font-mono">
        <div className="text-center">
          <h1 className="text-neon font-display text-3xl font-black tracking-[0.2em]">APEX</h1>
          <p className="text-[10px] tracking-[0.4em] text-muted-foreground mt-1">{mode === "up" ? "CREATE OWNER ACCOUNT" : "RESTRICTED ACCESS"}</p>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <input className={input} type="email" required placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={input} type="password" required minLength={8} placeholder="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button disabled={busy} className="w-full rounded border border-border bg-terminal px-4 py-2 text-xs tracking-widest text-neon disabled:opacity-40">
            {mode === "up" ? "SIGN UP" : "SIGN IN"}
          </button>
        </form>
        <button onClick={google} className="w-full rounded border border-border bg-terminal px-4 py-2 text-xs tracking-widest text-gold">CONTINUE WITH GOOGLE</button>
        {canSignUp && (
          <button onClick={() => setMode(mode === "in" ? "up" : "in")} className="w-full text-[10px] tracking-widest text-muted-foreground hover:text-neon">
            {mode === "in" ? "NO ACCOUNT? SIGN UP" : "HAVE AN ACCOUNT? SIGN IN"}
          </button>
        )}
        {msg && <p className="text-xs text-center text-muted-foreground">{msg}</p>}
      </div>
    </div>
  );
}
