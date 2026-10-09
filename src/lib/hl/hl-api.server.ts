// Hyperliquid PUBLIC info API client (no auth). Throttled + retry with backoff on 429/5xx.
const URL = "https://api.hyperliquid.xyz/info";
const MIN_GAP_MS = 250;
let lastCall = 0;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function hlInfo<T>(body: unknown): Promise<T> {
  let delay = 1000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastCall + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const res = await fetch(URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return (await res.json()) as T;
    if (res.status === 429 || res.status >= 500) {
      await sleep(delay);
      delay *= 2;
      continue;
    }
    throw new Error(`Hyperliquid ${res.status}: ${await res.text()}`);
  }
  throw new Error("Hyperliquid: too many retries (rate limited)");
}
