import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertOwner } from "@/lib/auth/owner.server";

// Owner-only: start a busted FX book over (new attempt, fresh 150 SEK at today's USD/SEK).
export const resetBookFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ book: z.enum(["sprint", "steady"]) }))
  .handler(async ({ data, context }) => {
    await assertOwner(context.supabase);
    const { supabaseAdmin: db } = await import("@/integrations/supabase/client.server");
    const { count } = await db.from("fx_positions").select("id", { count: "exact", head: true }).eq("book", data.book).eq("status", "open");
    if ((count ?? 0) > 0) throw new Error("Close the open positions in this book before resetting it.");
    const [{ data: b, error: be }, { data: cfg }] = await Promise.all([
      db.from("fx_books").select("attempt,start_sek").eq("id", data.book).single(),
      db.from("desk_config").select("usd_sek").eq("id", 1).maybeSingle(),
    ]);
    if (be || !b) throw new Error(be?.message ?? "Book not found");
    const usdSek = Number(cfg?.usd_sek);
    if (!(usdSek > 0)) throw new Error("No USD/SEK rate yet");
    const startUsd = Math.round((+b.start_sek / usdSek) * 1e4) / 1e4;
    const { error } = await db.from("fx_books").update({
      status: "active", attempt: b.attempt + 1, start_usd: startUsd, cash_usd: startUsd, reset_at: new Date().toISOString(),
    }).eq("id", data.book);
    if (error) throw new Error(error.message);
    return { book: data.book, attempt: b.attempt + 1, start_usd: startUsd };
  });
