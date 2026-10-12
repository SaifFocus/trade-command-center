// Invo bridge parsing (pure). The bridge on the owner's computer opens each followed Invo portfolio in a real browser
// and sends back whatever JSON the Invo app downloaded. Nothing here depends on Invo's endpoint paths or exact field
// names: positions are recognised by content (a coin, a side, an entry price, an open time), so a renamed field or a
// moved endpoint degrades to "fewer matches" and a logged problem instead of wrong trades.

export type Capture = { url: string; method?: string; status?: number; req?: string | null; body: unknown };
export type InvoTarget = { portfolio_id: string; username: string };

export type InvoPosition = {
  key: string; coin: string; side: "long" | "short"; entry_px: number; opened_at: string;
  leverage: number | null; size_frac: number | null;
};
export type ParsedVisit = {
  /** Something about this portfolio was understood (a declared open count or at least one position). */
  ok: boolean;
  open: InvoPosition[];
  /** Positions the captures show as closed (open flag false or a close time/price). */
  closed: (InvoPosition & { closed_at: string | null })[];
  /** Open-position count the app itself shows for this portfolio (largest one found), if any. */
  declared_open: number | null;
  /** The open list is known to be the whole list (declared count reached). */
  complete: boolean;
  /** Every list of open positions came newest-first, so a page holds every position newer than its oldest entry. */
  newest_first: boolean;
  notes: string[];
};

const lc = (s: string) => s.toLowerCase();
const COIN_KEYS = ["assetsymbol", "ticker", "symbol", "coin", "asset", "name", "pair", "market"];
const SIDE_KEYS = ["side", "direction", "positionside", "tradeside", "type"];
const LONG_BOOL_KEYS = ["directionlong", "islong", "long"];
const ENTRY_KEYS = ["entrypx", "entryprice", "entry_price", "avgentryprice", "avgentrypx", "averageentryprice", "openprice", "open_price", "averageprice", "avgprice", "entry"];
const OPENED_KEYS = ["openedat", "opened_at", "customentrydate", "entrydate", "entry_date", "opentime", "open_time", "createdat", "created_at"];
const CLOSED_AT_KEYS = ["closedat", "closed_at", "closetime", "exitdate"];
const EXIT_KEYS = ["exitpx", "exitprice", "closingprice", "closeprice", "exit_price"];
const OPEN_FLAG_KEYS = ["isopen", "open", "is_open"];
const COUNT_KEYS = ["openpositions", "opentrades", "opencount", "openpositionscount", "open_positions", "opentradescount"];

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
};
const isoOf = (v: unknown): string | null => {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
  if (typeof v === "number" && v > 1e12 && v < 1e14) return new Date(v).toISOString(); // epoch ms
  if (typeof v === "number" && v > 1e9 && v < 1e10) return new Date(v * 1000).toISOString(); // epoch s
  return null;
};
/** Case-insensitive key lookup in preference order. */
function pick(o: Record<string, unknown>, keys: string[]): unknown {
  const m = new Map(Object.keys(o).map((k) => [lc(k), k]));
  for (const k of keys) { const real = m.get(k); if (real !== undefined && o[real] !== null && o[real] !== undefined) return o[real]; }
  return undefined;
}
const COIN_RE = /^[A-Za-z0-9]{1,15}([-/_:][A-Za-z0-9]{2,6})?$/;
function coinOf(o: Record<string, unknown>): string | null {
  const v = pick(o, COIN_KEYS);
  if (typeof v === "string" && COIN_RE.test(v.trim())) return v.trim();
  if (v && typeof v === "object" && !Array.isArray(v)) { const inner = pick(v as Record<string, unknown>, ["symbol", "ticker", "coin", "name"]); if (typeof inner === "string" && COIN_RE.test(inner.trim())) return inner.trim(); }
  return null;
}
function sideOf(o: Record<string, unknown>): "long" | "short" | null {
  const s = pick(o, SIDE_KEYS);
  if (typeof s === "string") { if (/^(long|buy|bid|b)$/i.test(s.trim())) return "long"; if (/^(short|sell|ask|a)$/i.test(s.trim())) return "short"; }
  const b = pick(o, LONG_BOOL_KEYS);
  if (typeof b === "boolean") return b ? "long" : "short";
  return null;
}
function sizeFracOf(o: Record<string, unknown>): number | null {
  const s = pick(o, ["size"]);
  if (s && typeof s === "object") { const p = num((s as Record<string, unknown>).pct); if (p != null) return p / 100; }
  const pct = num(pick(o, ["sizepct", "size_pct", "positionpct"]));
  if (pct != null) return pct / 100;
  const ps = num(pick(o, ["positionsize"]));
  return ps != null && ps > 0 && ps <= 1 ? ps : null;
}
function idOf(o: Record<string, unknown>): string | null {
  const v = pick(o, ["id", "positionid", "investmentid", "uuid"]);
  return typeof v === "string" || typeof v === "number" ? String(v) : null;
}
function belongsElsewhere(o: Record<string, unknown>, t: InvoTarget): boolean {
  const pid = pick(o, ["portfolioid", "portfolio_id"]);
  if (typeof pid === "string" && pid !== t.portfolio_id) return true;
  const p = pick(o, ["portfolio"]);
  if (p && typeof p === "object" && typeof (p as Record<string, unknown>).id === "string" && (p as Record<string, unknown>).id !== t.portfolio_id) return true;
  const owner = pick(o, ["owner", "user"]);
  const un = owner && typeof owner === "object" ? (owner as Record<string, unknown>).username : undefined;
  return typeof un === "string" && t.username !== "" && lc(un) !== lc(t.username);
}

type Trade = InvoPosition & { isOpen: boolean; closed_at: string | null };
/** One object -> a position, or null when it does not look like one. */
export function toTrade(o: Record<string, unknown>): Trade | null {
  const coin = coinOf(o), side = sideOf(o), entry = num(pick(o, ENTRY_KEYS));
  let opened: string | null = null;
  for (const k of OPENED_KEYS) { const v = pick(o, [k]); const iso = isoOf(v); if (iso) { opened = iso; break; } }
  if (!coin || !side || !(entry != null && entry > 0) || !opened) return null;
  const flag = pick(o, OPEN_FLAG_KEYS);
  const closedAt = isoOf(pick(o, CLOSED_AT_KEYS));
  const exit = num(pick(o, EXIT_KEYS));
  const isOpen = typeof flag === "boolean" ? flag : !(closedAt || (exit != null && exit > 0));
  const lev = pick(o, ["leverage"]);
  const leverage = num(lev) ?? (lev && typeof lev === "object" ? num((lev as Record<string, unknown>).value) : null);
  return { key: idOf(o) ?? `${coin}|${side}|${opened}`, coin, side, entry_px: entry, opened_at: opened, leverage, size_frac: sizeFracOf(o), isOpen, closed_at: closedAt };
}

/** Walks every capture of one portfolio visit and pulls out its positions and declared open count. */
export function parseVisit(t: InvoTarget, captures: Capture[]): ParsedVisit {
  const open = new Map<string, InvoPosition>();
  const closed = new Map<string, InvoPosition & { closed_at: string | null }>();
  const counts: number[] = [];
  const notes: string[] = [];
  let foreign = 0, newestFirst = true;
  const visit = (v: unknown, depth: number, aboutTarget: boolean) => {
    if (depth > 12 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      // Order check on this list's open positions: newest-first or not.
      const ts = v.map((x) => (x && typeof x === "object" && !Array.isArray(x) ? toTrade(x as Record<string, unknown>) : null))
        .filter((x): x is Trade => !!x && x.isOpen).map((x) => Date.parse(x.opened_at));
      for (let i = 1; i < ts.length; i++) if (ts[i] > ts[i - 1]) { newestFirst = false; break; }
      for (const x of v) visit(x, depth + 1, aboutTarget);
      return;
    }
    const o = v as Record<string, unknown>;
    const idv = pick(o, ["id", "portfolioid", "portfolio_id"]);
    const isTargetObj = idv === t.portfolio_id;
    const tr = toTrade(o);
    if (tr) {
      if (belongsElsewhere(o, t)) foreign++;
      else if (tr.isOpen) open.set(tr.key, stripTrade(tr));
      else closed.set(tr.key, { ...stripTrade(tr), closed_at: tr.closed_at });
    }
    if (isTargetObj || aboutTarget) {
      const c = pick(o, COUNT_KEYS);
      const n = num(c) ?? (c && typeof c === "object" ? num((c as Record<string, unknown>).count) : null);
      if (n != null && n >= 0 && Number.isInteger(n)) counts.push(n);
    }
    for (const [k, x] of Object.entries(o)) if (x && typeof x === "object") visit(x, depth + 1, (isTargetObj || aboutTarget) && !/^(owner|user|portfolios|feed|posts|recommend)/i.test(k));
  };
  for (const c of captures) {
    if (!c || c.body === null || typeof c.body !== "object") continue;
    // A response is "about" the target when its URL or request names the portfolio (count fields at its top level count).
    const about = (c.url ?? "").includes(t.portfolio_id) || (c.req ?? "").includes(t.portfolio_id);
    visit(c.body, 0, about);
  }
  for (const k of closed.keys()) open.delete(k);
  const declared = counts.length ? Math.max(...counts) : null;
  if (foreign) notes.push(`${foreign} positions of other portfolios ignored`);
  const list = Array.from(open.values());
  const complete = declared != null && list.length >= declared;
  if (declared != null && list.length > declared) notes.push(`found ${list.length} open, app says ${declared}`);
  return { ok: declared != null || list.length > 0 || closed.size > 0, open: list, closed: Array.from(closed.values()), declared_open: declared, complete, newest_first: newestFirst, notes };
}
const stripTrade = (t: Trade): InvoPosition => ({ key: t.key, coin: t.coin, side: t.side, entry_px: t.entry_px, opened_at: t.opened_at, leverage: t.leverage, size_frac: t.size_frac });

/** Invo symbol -> Hyperliquid coin (null when Hyperliquid has no such perp). */
export function normalizeCoin(raw: string, universe: Set<string>): string | null {
  const base = raw.trim().toUpperCase().replace(/([-/_:]?(USDT|USDC|USD|PERP))$/, "");
  if (universe.has(base)) return base;
  if (universe.has(raw.trim())) return raw.trim();
  const k = "k" + base;
  if (universe.has(k)) return k;
  return null;
}

export type HeldRow = { coin: string; side: "long" | "short"; entry_px: number | null; opened_at: string };
export type InvoEvent = { kind: "open" | "close"; coin: string; side: "long" | "short"; entry_px: number | null; leverage: number | null; size_frac: number | null };
export type InvoDiff = { upserts: (HeldRow & { leverage: number | null; size_frac: number | null })[]; deletes: string[]; events: InvoEvent[]; unknown: string[] };

/**
 * Compares the stored snapshot with this visit, one position per coin (like a Hyperliquid wallet).
 * Opens: coins that are new (or flipped side). Closes: only when certain — the list is complete, the captures show
 * the position closed, or the list is a newest-first page whose oldest entry is older than the stored position.
 * Anything else stays as it was ("unknown"), so a partial page or a parsing gap never closes a follow.
 */
export function diffInvo(prev: HeldRow[], v: ParsedVisit, coinMap: (raw: string) => string | null, baseline: boolean): InvoDiff {
  const cur = new Map<string, InvoPosition & { coin: string }>();
  for (const p of [...v.open].sort((a, b) => Date.parse(b.opened_at) - Date.parse(a.opened_at))) {
    const coin = coinMap(p.coin); if (!coin || cur.has(coin)) continue; // newest position per coin wins
    cur.set(coin, { ...p, coin });
  }
  const closedBy = new Map<string, (InvoPosition & { closed_at: string | null })[]>();
  for (const c of v.closed) { const coin = coinMap(c.coin); if (coin) closedBy.set(coin, [...(closedBy.get(coin) ?? []), c]); }
  const minOpened = v.open.length ? Math.min(...v.open.map((p) => Date.parse(p.opened_at))) : null;
  const pm = new Map(prev.map((p) => [p.coin, p]));
  const out: InvoDiff = { upserts: [], deletes: [], events: [], unknown: [] };
  const ev = (kind: "open" | "close", coin: string, side: "long" | "short", p?: InvoPosition) => {
    if (!baseline) out.events.push({ kind, coin, side, entry_px: p?.entry_px ?? null, leverage: p?.leverage ?? null, size_frac: p?.size_frac ?? null });
  };
  for (const [coin, p] of cur) {
    const old = pm.get(coin);
    if (!old) ev("open", coin, p.side, p);
    else if (old.side !== p.side) { ev("close", coin, old.side); ev("open", coin, p.side, p); }
    out.upserts.push({ coin, side: p.side, entry_px: p.entry_px, opened_at: p.opened_at, leverage: p.leverage, size_frac: p.size_frac });
  }
  for (const old of prev) {
    if (cur.has(old.coin)) continue;
    const shownClosed = (closedBy.get(old.coin) ?? []).some((c) => c.side === old.side && (!c.closed_at || Date.parse(c.closed_at) >= Date.parse(old.opened_at)));
    const pageCovers = v.newest_first && minOpened != null && Date.parse(old.opened_at) >= minOpened;
    if (v.complete || shownClosed || pageCovers) { ev("close", old.coin, old.side); out.deletes.push(old.coin); }
    else out.unknown.push(old.coin);
  }
  return out;
}
