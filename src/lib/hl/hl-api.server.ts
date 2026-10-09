// Hyperliquid PUBLIC info API client (no auth). Every caller shares one DB token bucket
// (public.take_weight, 800 weight/min) so desk sync, scout deep-dives and tracking never exceed the IP limit.
const URL = "https://api.hyperliquid.xyz/info";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Request weight per Hyperliquid docs (base part; per-item extras are charged after the response). */
export function baseWeight(body: any): number {
  const t = body?.type;
  if (t === "clearinghouseState" || t === "allMids" || t === "l2Book" || t === "orderStatus") return 2;
  return 20;
}
function extraWeight(body: any, res: unknown): number {
  if (!Array.isArray(res)) return 0;
  if (body?.type === "userFillsByTime" || body?.type === "userFills") return Math.floor(res.length / 20);
  if (body?.type === "candleSnapshot") return Math.floor(res.length / 60);
  return 0;
}

async function take(weight: number) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  for (let i = 0; i < 200; i++) {
    const { data, error } = await supabaseAdmin.rpc("take_weight", { p: weight });
    if (error) throw new Error(`rate budget: ${error.message}`);
    const wait = Number(data ?? 0);
    if (wait <= 0) return;
    await sleep(Math.min(wait, 5000));
  }
  throw new Error("rate budget: waited too long");
}

export async function hlInfo<T>(body: unknown): Promise<T> {
  let delay = 2000;
  for (let attempt = 0; attempt < 6; attempt++) {
    await take(baseWeight(body));
    const res = await fetch(URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) {
      const j = (await res.json()) as T;
      const extra = extraWeight(body, j);
      if (extra > 0) await take(extra);
      return j;
    }
    if (res.status === 429 || res.status >= 500) { await sleep(delay); delay *= 2; continue; }
    throw new Error(`Hyperliquid ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  throw new Error("Hyperliquid: too many retries (rate limited)");
}
