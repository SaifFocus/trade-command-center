// Runs the real engine (src/lib/hl/engine.ts) on the exported data, so lab results can be checked against production code.
import { readFileSync, writeFileSync } from "node:fs";
import { runBacktest, summarize, type CoinData, type Bar } from "../../src/lib/hl/engine";

const DATA = process.env.LAB_DATA!;
const h4 = JSON.parse(readFileSync(`${DATA}/h4.json`, "utf8")) as Record<string, number[][]>;
const d1 = JSON.parse(readFileSync(`${DATA}/d1.json`, "utf8")) as Record<string, number[][]>;
const H = 3600_000;
const bars = (rows: number[][]): Bar[] => rows.map((r) => ({ t: r[0] * H, o: r[1], h: r[2], l: r[3], c: r[4], v: r[5] }));
const only = process.env.COINS ? new Set(process.env.COINS.split(",")) : null;
const coins: CoinData[] = Object.keys(h4).map((coin) => ({
  coin, c4h: bars(h4[coin]), c1d: bars(d1[coin] ?? []),
  f4h: new Map(h4[coin].map((r) => [r[0] * H, { s: r[6], n: 4 }])),
}));
const trade = only ? new Set(Array.from(only)) : undefined;
const { trades, startT, endT, splitT } = runBacktest(coins, { name: "lab", feePct: 0.045, slipPct: 0.05, setups: process.env.SETUPS ? process.env.SETUPS.split(",") : undefined, maxOpen: process.env.MAXOPEN ? +process.env.MAXOPEN : undefined }, "BTC", trade);
const s = summarize(trades);
const pick = (x: ReturnType<typeof summarize>["all"]) => ({ n: x.trades, wr: x.win_rate, avgR: x.avg_net_r, pf: x.profit_factor, ddR: x.max_drawdown_r, ret: x.final_return_pct, dd: x.max_drawdown_pct });
console.log(JSON.stringify({ from: new Date(startT).toISOString().slice(0, 10), to: new Date(endT).toISOString().slice(0, 10), split: new Date(splitT).toISOString().slice(0, 10) }));
console.log("all", JSON.stringify(pick(s.all)));
console.log("in ", JSON.stringify(pick(s.in)));
console.log("out", JSON.stringify(pick(s.out)));
for (const [k, v] of Object.entries(s.by_setup_sample)) if (v.trades) console.log(k.padEnd(36), JSON.stringify(pick(v)));
console.log("gate", JSON.stringify(s.gate));
if (process.env.DUMP) writeFileSync(process.env.DUMP, JSON.stringify(trades));
