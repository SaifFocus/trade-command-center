// Pure logic for the Desk "TRADE GRID" panel. No I/O.

export type Unit = "R" | "%";
export type Outcome = "big_win" | "win" | "flat" | "loss" | "big_loss";

export interface GridTrade {
  id: string;
  coin: string;
  side: string;
  setup: string | null;
  trader: string | null;
  exitT: string; // ISO
  exitReason: string | null;
  result: number; // R or %
  usd: number | null;
}

const THRESH: Record<Unit, { big: number; flat: number }> = {
  R: { big: 0.5, flat: 0.05 },
  "%": { big: 2, flat: 0.1 },
};

export function classify(result: number, unit: Unit): Outcome {
  const t = THRESH[unit];
  if (Math.abs(result) < t.flat) return "flat";
  if (result >= t.big) return "big_win";
  if (result > 0) return "win";
  if (result <= -t.big) return "big_loss";
  return "loss";
}

const hourFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Stockholm", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
});

/** Clock-hour key in Europe/Stockholm, e.g. "2026-10-26, 14". */
export function stockholmHour(iso: string): string {
  return hourFmt.format(new Date(iso));
}

export interface Stats {
  trades: number;
  winRate: number | null; // %
  avg: number | null;
  total: number;
  totalUsd: number;
  profitFactor: number | null; // null = no losses
  independent: number;
}

export function stats(trades: GridTrade[], unit: Unit): Stats {
  let wins = 0, sumW = 0, sumL = 0, total = 0, totalUsd = 0;
  const hours = new Set<string>();
  for (const t of trades) {
    const o = classify(t.result, unit);
    if (o === "win" || o === "big_win") wins++;
    if (t.result > 0) sumW += t.result;
    else if (t.result < 0) sumL += t.result;
    total += t.result;
    totalUsd += t.usd ?? 0;
    hours.add(stockholmHour(t.exitT));
  }
  const n = trades.length;
  return {
    trades: n,
    winRate: n ? (wins / n) * 100 : null,
    avg: n ? total / n : null,
    total,
    totalUsd,
    profitFactor: sumL < 0 ? sumW / Math.abs(sumL) : null,
    independent: hours.size,
  };
}

/** For each trade id, how many OTHER trades in the view closed in the same Stockholm clock hour. */
export function sameHourClusters(trades: GridTrade[]): Map<string, number> {
  const byHour = new Map<string, string[]>();
  for (const t of trades) {
    const k = stockholmHour(t.exitT);
    const arr = byHour.get(k) ?? [];
    arr.push(t.id);
    byHour.set(k, arr);
  }
  const out = new Map<string, number>();
  for (const ids of byHour.values()) for (const id of ids) out.set(id, ids.length - 1);
  return out;
}

export type GroupKey = "none" | "setup" | "trader" | "coin" | "side";

export interface Group { name: string; trades: GridTrade[]; stats: Stats }

export function groupTrades(trades: GridTrade[], key: Exclude<GroupKey, "none">, unit: Unit): Group[] {
  const m = new Map<string, GridTrade[]>();
  for (const t of trades) {
    const name = key === "setup" ? t.setup ?? "—" : key === "trader" ? t.trader ?? "None" : key === "coin" ? t.coin : t.side;
    const arr = m.get(name) ?? [];
    arr.push(t);
    m.set(name, arr);
  }
  return [...m.entries()]
    .map(([name, ts]) => ({ name, trades: ts, stats: stats(ts, unit) }))
    .sort((a, b) => b.stats.total - a.stats.total || a.name.localeCompare(b.name));
}

/** Trader label: display_name before " · ", else short address; "invo:" names stay readable. */
export function traderLabel(address: string, displayName?: string | null): string {
  if (displayName) {
    const n = displayName.split(" · ")[0].trim();
    if (n) return n;
  }
  if (address.startsWith("invo:")) return address.slice(5) || address;
  if (address.length > 12) return `${address.slice(0, 6)}…${address.slice(-4)}`;
  return address;
}
