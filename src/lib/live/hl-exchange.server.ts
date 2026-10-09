// Hyperliquid trading adapter for the LIVE desk. The only file that touches the agent key.
// Secrets come from the server environment and are never returned, logged or sent to the browser:
//   HL_AGENT_PRIVATE_KEY  API (agent) wallet key: can trade and move funds only within the same account;
//                         it can never withdraw or send to another address
//   HL_ACCOUNT_ADDRESS    the owner's main Hyperliquid account the agent trades for
//   HL_NETWORK            'mainnet' | 'testnet' (default 'testnet')
//   HL_DRY_RUN            'true' → every order is built and logged but never sent
// Env is read inside functions only: on Cloudflare Workers it binds at request time.
import process from "node:process";
import { ApiRequestError, ExchangeClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { newCloid, type AssetInfo, type ExchOrder, type ExchPos, type OrderSpec } from "./live-risk";

export type Network = "mainnet" | "testnet";
export type Fill = {
  tid: number; oid: number; coin: string; side: "B" | "A"; dir: string; px: number; sz: number;
  fee: number; feeToken: string; closedPnl: number; time: number; hash: string; raw: unknown;
};
export type PlaceResult =
  | { status: "filled"; oid: number; totalSz: number; avgPx: number; raw: unknown }
  | { status: "resting"; oid: number; raw: unknown }
  | { status: "waiting"; raw: unknown }
  | { status: "error"; error: string; raw: unknown } // the exchange rejected it: nothing happened
  | { status: "unknown"; error: string; raw: unknown }; // network/timeout: it may or may not have executed
export type MarketInfo = AssetInfo & { mark: number; dayNtlVlm: number; isDelisted: boolean };

/** Everything the live desk needs from the exchange. Implemented by HyperliquidLive and by test fakes. */
export interface LiveExchange {
  readonly network: Network;
  readonly dryRun: boolean;
  readonly account: `0x${string}`;
  readonly agent: `0x${string}`;
  markets(): Promise<Map<string, MarketInfo>>;
  mids(): Promise<Record<string, number>>;
  state(): Promise<{ accountValue: number; withdrawable: number; positions: ExchPos[] }>;
  openOrders(): Promise<ExchOrder[]>;
  fillsSince(ms: number): Promise<Fill[]>;
  fundingSince(ms: number, coin?: string, endMs?: number): Promise<number>;
  transfersSince(ms: number, endMs?: number): Promise<{ time: number; delta: { type: string; [k: string]: unknown } }[]>;
  agentRole(): Promise<{ ok: boolean; detail: string; validUntil: number | null; name: string | null }>;
  setLeverage(asset: number, leverage: number): Promise<{ ok: boolean; error?: string }>;
  place(o: OrderSpec, cloid?: `0x${string}`): Promise<PlaceResult>;
  cancel(asset: number, oid: number): Promise<{ ok: boolean; error?: string }>;
}

export type LiveEnv =
  | { ok: true; key: `0x${string}`; account: `0x${string}`; network: Network; dryRun: boolean }
  | { ok: false; missing: string[]; network: Network; dryRun: boolean };

export function readLiveEnv(env: Record<string, string | undefined> = process.env): LiveEnv {
  const network: Network = (env.HL_NETWORK ?? "").trim().toLowerCase() === "mainnet" ? "mainnet" : "testnet";
  const dryRun = (env.HL_DRY_RUN ?? "").trim().toLowerCase() === "true";
  const missing: string[] = [];
  let key = (env.HL_AGENT_PRIVATE_KEY ?? "").trim();
  if (key && !key.startsWith("0x")) key = `0x${key}`;
  const account = (env.HL_ACCOUNT_ADDRESS ?? "").trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) missing.push("HL_AGENT_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) missing.push("HL_ACCOUNT_ADDRESS");
  if (missing.length) return { ok: false, missing, network, dryRun };
  return { ok: true, key: key as `0x${string}`, account: account.toLowerCase() as `0x${string}`, network, dryRun };
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const errText = (e: unknown) => (e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : String(e));

/** Shares the public-API weight budget (take_weight, 800/min) with every other job when on mainnet. */
async function weigh(network: Network, weight: number) {
  if (network !== "mainnet" || weight <= 0) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  for (let i = 0; i < 60; i++) {
    const { data, error } = await supabaseAdmin.rpc("take_weight", { p: weight });
    if (error) throw new Error(`rate budget: ${error.message}`);
    const wait = Number(data ?? 0);
    if (wait <= 0) return;
    await new Promise((r) => setTimeout(r, Math.min(wait, 5000)));
  }
  throw new Error("rate budget: waited too long");
}

export class HyperliquidLive implements LiveExchange {
  readonly network: Network;
  readonly dryRun: boolean;
  readonly account: `0x${string}`;
  readonly agent: `0x${string}`;
  private info: InfoClient;
  private ex: ExchangeClient;

  constructor(env: Extract<LiveEnv, { ok: true }>) {
    this.network = env.network;
    this.dryRun = env.dryRun;
    this.account = env.account;
    const wallet = privateKeyToAccount(env.key);
    this.agent = wallet.address.toLowerCase() as `0x${string}`;
    const transport = new HttpTransport({ isTestnet: env.network === "testnet", timeout: 15_000 });
    this.info = new InfoClient({ transport });
    this.ex = new ExchangeClient({ transport, wallet });
  }

  async markets() {
    await weigh(this.network, 20);
    const [meta, ctxs] = await this.info.metaAndAssetCtxs();
    const out = new Map<string, MarketInfo>();
    meta.universe.forEach((u, i) => {
      const c = ctxs[i] as { markPx?: string; dayNtlVlm?: string } | undefined;
      out.set(u.name, {
        coin: u.name, asset: i, szDecimals: u.szDecimals, maxLeverage: u.maxLeverage,
        mark: num(c?.markPx), dayNtlVlm: num(c?.dayNtlVlm), isDelisted: Boolean((u as { isDelisted?: boolean }).isDelisted),
      });
    });
    return out;
  }

  async mids() {
    await weigh(this.network, 2);
    const m = await this.info.allMids();
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, num(v)]));
  }

  async state() {
    await weigh(this.network, 2);
    const s = await this.info.clearinghouseState({ user: this.account });
    return {
      accountValue: num(s.marginSummary.accountValue),
      withdrawable: num(s.withdrawable),
      positions: s.assetPositions.map(({ position: p }) => ({
        coin: p.coin, szi: num(p.szi), entryPx: num(p.entryPx), unrealizedPnl: num(p.unrealizedPnl),
      })),
    };
  }

  async openOrders() {
    await weigh(this.network, 20);
    const os = await this.info.frontendOpenOrders({ user: this.account });
    return os.map((o) => ({
      oid: o.oid, coin: o.coin, isTrigger: o.isTrigger, reduceOnly: o.reduceOnly, sz: num(o.sz), triggerPx: num(o.triggerPx), side: o.side,
    }));
  }

  async fillsSince(ms: number) {
    const out: Fill[] = [];
    let start = ms;
    for (let page = 0; page < 10; page++) {
      await weigh(this.network, 20);
      const fs = await this.info.userFillsByTime({ user: this.account, startTime: start, aggregateByTime: false });
      await weigh(this.network, Math.floor(fs.length / 20));
      for (const f of fs)
        out.push({
          tid: f.tid, oid: f.oid, coin: f.coin, side: f.side, dir: f.dir, px: num(f.px), sz: num(f.sz), fee: num(f.fee),
          feeToken: f.feeToken, closedPnl: num(f.closedPnl), time: f.time, hash: f.hash, raw: f,
        });
      if (fs.length < 2000) break;
      start = Math.max(...fs.map((f) => f.time)) + 1;
    }
    return out;
  }

  async fundingSince(ms: number, coin?: string, endMs?: number) {
    let total = 0;
    let start = ms;
    for (let page = 0; page < 10; page++) {
      await weigh(this.network, 20);
      const rows = await this.info.userFunding({ user: this.account, startTime: start, ...(endMs ? { endTime: endMs } : {}) });
      for (const r of rows) {
        const d = r.delta as { usdc?: string; coin?: string };
        if (!coin || d.coin === coin) total += num(d.usdc);
      }
      if (rows.length < 500) break;
      start = Math.max(...rows.map((r) => r.time)) + 1;
    }
    return total;
  }

  async transfersSince(ms: number, endMs?: number) {
    await weigh(this.network, 20);
    const rows = await this.info.userNonFundingLedgerUpdates({ user: this.account, startTime: ms, ...(endMs ? { endTime: endMs } : {}) });
    return rows.map((r) => ({ time: r.time, delta: r.delta as unknown as { type: string; [k: string]: unknown } }));
  }

  async agentRole() {
    await weigh(this.network, 40);
    const [role, extras] = await Promise.all([
      this.info.userRole({ user: this.agent }),
      this.info.extraAgents({ user: this.account }).catch(() => [] as { address: string; name: string; validUntil: number | null }[]),
    ]);
    const named = extras.find((a) => a.address.toLowerCase() === this.agent);
    const linked = role.role === "agent" && role.data.user.toLowerCase() === this.account;
    const expired = named?.validUntil != null && named.validUntil < Date.now();
    return {
      ok: linked && !expired,
      detail: linked
        ? expired ? "agent key has expired" : "agent key is approved for this account"
        : role.role === "agent" ? "agent key belongs to a different account" : `agent key is not approved (role: ${role.role})`,
      validUntil: named?.validUntil ?? null,
      name: named?.name ?? null,
    };
  }

  async setLeverage(asset: number, leverage: number) {
    if (this.dryRun) return { ok: true };
    try {
      await this.ex.updateLeverage({ asset, isCross: false, leverage });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
  }

  async place(o: OrderSpec, cloid?: `0x${string}`): Promise<PlaceResult> {
    // Every order carries a client id so it can be found again if the response does not include an oid.
    const c = cloid ?? newCloid();
    const order = {
      a: o.asset, b: o.isBuy, p: o.px, s: o.size, r: o.reduceOnly,
      t: o.trigger ? { trigger: o.trigger } : { limit: { tif: o.tif ?? "Gtc" } },
      c,
    };
    if (this.dryRun) return { status: "error", error: "dry run: not sent", raw: { dryRun: true, order } };
    try {
      const res = await this.ex.order({ orders: [order], grouping: "na" });
      // Error statuses are excluded from the SDK's success type but are handled defensively anyway.
      const st = res.response.data.statuses[0] as unknown as
        | { filled: { oid: number; totalSz: string; avgPx: string } }
        | { resting: { oid: number } }
        | { error: string }
        | string
        | undefined;
      if (st && typeof st === "object") {
        if ("filled" in st) return { status: "filled", oid: st.filled.oid, totalSz: num(st.filled.totalSz), avgPx: num(st.filled.avgPx), raw: res };
        if ("resting" in st) return { status: "resting", oid: st.resting.oid, raw: res };
        if ("error" in st) return { status: "error", error: st.error, raw: res };
      }
      // "waitingForTrigger" / "waitingForFill": look the order up by its client id to get the oid.
      await weigh(this.network, 20);
      const open = await this.info.frontendOpenOrders({ user: this.account }).catch(() => []);
      const found = open.find((x) => x.cloid?.toLowerCase() === c.toLowerCase());
      if (found) return { status: "resting", oid: found.oid, raw: res };
      return { status: "waiting", raw: res };
    } catch (e) {
      if (e instanceof ApiRequestError) return { status: "error", error: errText(e), raw: e.response };
      return { status: "unknown", error: errText(e), raw: null };
    }
  }

  async cancel(asset: number, oid: number) {
    if (this.dryRun) return { ok: true };
    try {
      await this.ex.cancel({ cancels: [{ a: asset, o: oid }] });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
  }
}

/** The configured exchange, or null when secrets are missing. */
export function liveExchange(): LiveExchange | null {
  const env = readLiveEnv();
  return env.ok ? new HyperliquidLive(env) : null;
}
