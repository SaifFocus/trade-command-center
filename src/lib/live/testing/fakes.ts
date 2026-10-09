// Test doubles for the live desk: an in-memory Supabase-like client and a simulated Hyperliquid account.
// Only used by tests.
import type { LiveExchange, MarketInfo, PlaceResult, Fill, Network } from "../hl-exchange.server";
import type { ExchOrder, ExchPos, OrderSpec } from "../live-risk";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

const DEFAULTS: Record<string, () => Row> = {
  live_positions: () => ({ id: uuid(), entry_t: new Date().toISOString(), status: "opening", size: 0, be_moved: false, t1_done: false }),
  live_orders: () => ({ id: ++seq, created_at: new Date().toISOString(), dry_run: false }),
  live_equity: () => ({ id: ++seq, t: new Date().toISOString() }),
  agent_logs: () => ({ id: ++seq, created_at: new Date().toISOString() }),
  signals: () => ({ id: uuid(), created_at: new Date().toISOString() }),
  paper_positions: () => ({ id: uuid() }),
};

export class FakeDB {
  tables = new Map<string, Row[]>();
  constructor(seed: Record<string, Row[]> = {}) {
    for (const [k, v] of Object.entries(seed)) this.tables.set(k, v.map((r) => ({ ...r })));
  }
  t(name: string) {
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name)!;
  }
  from(name: string) {
    return new Q(this, name);
  }
  /** Emulates the live_lock / live_unlock SQL functions on desk_config. */
  async rpc(fn: string, args: Row) {
    const c = this.t("desk_config")[0];
    if (fn === "live_lock") {
      const free = !c.live_lock_until || Date.parse(c.live_lock_until) < Date.now() || c.live_lock_owner === args.p_owner;
      if (free) { c.live_lock_owner = args.p_owner; c.live_lock_until = new Date(Date.now() + args.p_seconds * 1000).toISOString(); }
      return { data: free, error: null };
    }
    if (fn === "live_unlock") {
      if (c.live_lock_owner === args.p_owner) { c.live_lock_owner = null; c.live_lock_until = null; }
      return { data: null, error: null };
    }
    return { data: null, error: { message: `unknown rpc ${fn}` } };
  }
  logs() {
    return this.t("agent_logs").map((l) => `${l.level}: ${l.message}`);
  }
}

class Q implements PromiseLike<{ data: unknown; error: { message: string } | null; count?: number }> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row | Row[] | null = null;
  private returning = false;
  private orderBy: { col: string; asc: boolean }[] = [];
  private lim: number | null = null;
  private one: "single" | "maybe" | null = null;
  private upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  constructor(private db: FakeDB, private name: string) {}
  select(_cols?: string, _opts?: unknown) { if (this.op === "select") this.op = "select"; else this.returning = true; return this; }
  insert(p: Row | Row[]) { this.op = "insert"; this.payload = p; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  upsert(p: Row | Row[], o: { onConflict?: string; ignoreDuplicates?: boolean } = {}) { this.op = "upsert"; this.payload = p; this.upsertOpts = o; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filters.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filters.push((r) => r[c] !== v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push((r) => vs.includes(r[c])); return this; }
  gte(c: string, v: string | number) { this.filters.push((r) => r[c] != null && cmp(r[c], v) >= 0); return this; }
  lt(c: string, v: string | number) { this.filters.push((r) => r[c] != null && cmp(r[c], v) < 0); return this; }
  order(col: string, o: { ascending?: boolean } = {}) { this.orderBy.push({ col, asc: o.ascending !== false }); return this; }
  limit(n: number) { this.lim = n; return this; }
  single() { this.one = "single"; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  then<A, B>(ok?: ((v: { data: unknown; error: { message: string } | null }) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.run()).then(ok, bad);
  }
  private run(): { data: unknown; error: { message: string } | null } {
    const tbl = this.db.t(this.name);
    const match = (r: Row) => this.filters.every((f) => f(r));
    let rows: Row[] = [];
    if (this.op === "insert") {
      const list = (Array.isArray(this.payload) ? this.payload : [this.payload!]).map((p) => ({ ...(DEFAULTS[this.name]?.() ?? {}), ...p }));
      if (this.name === "live_positions") {
        for (const r of list)
          if (["opening", "open", "closing"].includes(r.status) && tbl.some((x) => x.coin === r.coin && ["opening", "open", "closing"].includes(x.status)))
            return { data: null, error: { message: "duplicate key value violates unique constraint live_positions_one_active_per_coin" } };
      }
      tbl.push(...list);
      rows = list;
    } else if (this.op === "upsert") {
      const key = this.upsertOpts.onConflict ?? "id";
      for (const p of Array.isArray(this.payload) ? this.payload : [this.payload!]) {
        const ex = tbl.find((r) => r[key] === p[key]);
        if (ex) { if (!this.upsertOpts.ignoreDuplicates) Object.assign(ex, p); }
        else tbl.push({ ...p });
      }
    } else if (this.op === "update") {
      rows = tbl.filter(match);
      for (const r of rows) Object.assign(r, this.payload);
    } else if (this.op === "delete") {
      rows = tbl.filter(match);
      this.db.tables.set(this.name, tbl.filter((r) => !match(r)));
    } else {
      rows = tbl.filter(match);
    }
    if (this.op === "select") {
      for (const o of [...this.orderBy].reverse()) rows = [...rows].sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.col], b[o.col]));
      if (this.lim != null) rows = rows.slice(0, this.lim);
    }
    const out = rows.map((r) => ({ ...r }));
    if (this.one) {
      if (!out.length) return this.one === "single" ? { data: null, error: { message: "no rows" } } : { data: null, error: null };
      return { data: out[0], error: null };
    }
    return { data: this.op === "select" || this.returning ? out : null, error: null };
  }
}
function cmp(a: unknown, b: unknown) {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const da = Date.parse(String(a)), dbb = Date.parse(String(b));
  if (!isNaN(da) && !isNaN(dbb) && /\d{4}-\d{2}-\d{2}/.test(String(a))) return da - dbb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

type Ord = OrderSpec & { oid: number };

/** A simulated Hyperliquid account: IOC orders fill at the mid, triggers fire on tick(). Fees 0.045%. */
export class FakeExchange implements LiveExchange {
  network: Network = "testnet";
  dryRun = false;
  account = "0x00000000000000000000000000000000000000aa" as const;
  agent = "0x00000000000000000000000000000000000000bb" as const;
  cash = 60;
  pos = new Map<string, { szi: number; entryPx: number }>();
  orders = new Map<number, Ord>();
  fills: Fill[] = [];
  px: Record<string, number> = { BTC: 100_000, ETH: 3_000, SOL: 150 };
  rejectTriggers = false;
  rejectHalfT1 = false;
  rejectCloses = false; // reduce-only IOC orders fail (outage while closing)
  partialCloseOnce: number | null = null; // next reduce-only IOC fills only this size
  transfers: { time: number; delta: { type: string; [k: string]: unknown } }[] = [];
  private oid = 100;
  private tid = 1;
  mk: Record<string, MarketInfo> = {
    BTC: { coin: "BTC", asset: 0, szDecimals: 5, maxLeverage: 40, mark: 0, dayNtlVlm: 1e9, isDelisted: false },
    ETH: { coin: "ETH", asset: 1, szDecimals: 4, maxLeverage: 25, mark: 0, dayNtlVlm: 5e8, isDelisted: false },
    SOL: { coin: "SOL", asset: 5, szDecimals: 2, maxLeverage: 20, mark: 0, dayNtlVlm: 2e8, isDelisted: false },
  };
  async markets() { return new Map(Object.values(this.mk).map((m) => [m.coin, { ...m, mark: this.px[m.coin] }])); }
  async mids() { return { ...this.px }; }
  async state() {
    const positions: ExchPos[] = [...this.pos.entries()].filter(([, p]) => p.szi !== 0).map(([coin, p]) => ({
      coin, szi: p.szi, entryPx: p.entryPx, unrealizedPnl: p.szi * (this.px[coin] - p.entryPx),
    }));
    return { accountValue: this.cash + positions.reduce((a, p) => a + p.unrealizedPnl, 0), withdrawable: this.cash, positions };
  }
  async openOrders(): Promise<ExchOrder[]> {
    return [...this.orders.values()].map((o) => ({ oid: o.oid, coin: o.coin, isTrigger: !!o.trigger, reduceOnly: o.reduceOnly, sz: +o.size, triggerPx: o.trigger ? +o.trigger.triggerPx : 0, side: o.isBuy ? "B" : "A" }));
  }
  async fillsSince(ms: number) { return this.fills.filter((f) => f.time >= ms); }
  async fundingSince() { return 0; }
  async transfersSince(ms: number, endMs?: number) { return this.transfers.filter((t) => t.time >= ms && (!endMs || t.time <= endMs)); }
  async agentRole() { return { ok: true, detail: "agent key is approved for this account", validUntil: null, name: "apex" }; }
  async setLeverage() { return { ok: true }; }
  async place(o: OrderSpec): Promise<PlaceResult> {
    // Hyperliquid: $10 minimum per order, except a reduce-only order that closes the whole position.
    const posSz = Math.abs(this.pos.get(o.coin)?.szi ?? 0);
    const value = +o.size * (o.trigger ? +o.trigger.triggerPx : +o.px);
    if (value < 10 && !(o.reduceOnly && +o.size >= posSz - 1e-12 && posSz > 0))
      return { status: "error", error: "Order must have minimum value of $10.", raw: null };
    if (o.trigger) {
      if (this.rejectTriggers) return { status: "error", error: "Order rejected (test)", raw: null };
      if (this.rejectHalfT1 && o.kind === "t1") return { status: "error", error: "Order must have minimum value of $10", raw: null };
      const oid = ++this.oid;
      this.orders.set(oid, { ...o, oid });
      return { status: "resting", oid, raw: null };
    }
    const mid = this.px[o.coin];
    if (o.reduceOnly && this.rejectCloses) return { status: "error", error: "Too many requests (test outage)", raw: null };
    if ((o.isBuy && +o.px < mid) || (!o.isBuy && +o.px > mid)) return { status: "error", error: "Order could not immediately match", raw: null };
    const oid = ++this.oid;
    let want = +o.size;
    if (o.reduceOnly && this.partialCloseOnce != null) { want = Math.min(want, this.partialCloseOnce); this.partialCloseOnce = null; }
    const sz = this.exec(o.coin, o.isBuy, want, mid, o.reduceOnly, oid);
    if (sz <= 0) return { status: "error", error: "Reduce only order would increase position", raw: null };
    return { status: "filled", oid, totalSz: sz, avgPx: mid, raw: null };
  }
  async cancel(_asset: number, oid: number) { return this.orders.delete(oid) ? { ok: true } : { ok: false, error: "Order was never placed, already canceled, or filled" }; }

  private exec(coin: string, isBuy: boolean, size: number, px: number, reduceOnly: boolean, oid: number) {
    const p = this.pos.get(coin) ?? { szi: 0, entryPx: 0 };
    const signed = isBuy ? size : -size;
    let sz = size;
    if (reduceOnly) {
      if (p.szi === 0 || Math.sign(signed) === Math.sign(p.szi)) return 0;
      sz = Math.min(size, Math.abs(p.szi));
    }
    const delta = isBuy ? sz : -sz;
    let closedPnl = 0;
    const startPosition = p.szi;
    if (p.szi !== 0 && Math.sign(delta) !== Math.sign(p.szi)) {
      const closing = Math.min(Math.abs(delta), Math.abs(p.szi));
      closedPnl = Math.sign(p.szi) * closing * (px - p.entryPx);
      p.szi += Math.sign(delta) * closing;
      if (p.szi === 0) p.entryPx = 0;
    } else {
      p.entryPx = (p.entryPx * Math.abs(p.szi) + px * Math.abs(delta)) / (Math.abs(p.szi) + Math.abs(delta));
      p.szi += delta;
    }
    p.szi = Math.round(p.szi * 1e8) / 1e8;
    this.pos.set(coin, p);
    const fee = sz * px * 0.00045;
    this.cash += closedPnl - fee;
    const dir = startPosition === 0 || Math.sign(delta) === Math.sign(startPosition) ? (isBuy ? "Open Long" : "Open Short") : (isBuy ? "Close Short" : "Close Long");
    this.fills.push({ tid: this.tid++, oid, coin, side: isBuy ? "B" : "A", dir, px, sz, fee, feeToken: "USDC", closedPnl, time: Date.now(), hash: "0x", raw: null });
    return sz;
  }

  /** Move the price and fire any triggers it crosses (market triggers fill at the trigger price). */
  tick(coin: string, price: number) {
    this.px[coin] = price;
    for (const o of [...this.orders.values()].filter((x) => x.coin === coin && x.trigger)) {
      const tp = +o.trigger!.triggerPx;
      const closesLong = !o.isBuy;
      const fire = o.trigger!.tpsl === "sl" ? (closesLong ? price <= tp : price >= tp) : (closesLong ? price >= tp : price <= tp);
      if (!fire) continue;
      this.orders.delete(o.oid);
      this.exec(coin, o.isBuy, +o.size, tp, true, o.oid);
    }
    // Reduce-only orders left with no position are cancelled by the exchange.
    if ((this.pos.get(coin)?.szi ?? 0) === 0) for (const o of [...this.orders.values()]) if (o.coin === coin && o.reduceOnly) this.orders.delete(o.oid);
  }
}
