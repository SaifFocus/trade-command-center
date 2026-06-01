export type Market = {
  id: string;
  name: string;
  emoji: string;
  seed: number;
  current: number;
  status: "SCANNING" | "PAPER TRADING";
  lastSignal: string;
  color: string;
  spark: { v: number }[];
};

const flat = (v: number, n = 24) => Array.from({ length: n }, () => ({ v }));

export const MARKETS: Market[] = [
  { id: "hype", name: "HYPE CRYPTO", emoji: "🚀", seed: 150, current: 150, status: "SCANNING", lastSignal: "Awaiting first signal...", color: "#FF3CAC", spark: flat(150) },
  { id: "swing", name: "SWING CRYPTO", emoji: "📈", seed: 150, current: 150, status: "PAPER TRADING", lastSignal: "Awaiting first signal...", color: "#F7931A", spark: flat(150) },
  { id: "us", name: "US STOCKS", emoji: "🏛️", seed: 150, current: 150, status: "SCANNING", lastSignal: "Awaiting first signal...", color: "#00D4FF", spark: flat(150) },
  { id: "nordic", name: "NORDIC STOCKS", emoji: "🇸🇪", seed: 150, current: 150, status: "PAPER TRADING", lastSignal: "Awaiting first signal...", color: "#00FF88", spark: flat(150) },
  { id: "meme", name: "MEME & SOCIAL", emoji: "🐸", seed: 100, current: 100, status: "SCANNING", lastSignal: "Awaiting first signal...", color: "#FFFF00", spark: flat(100) },
  { id: "forex", name: "FOREX", emoji: "💱", seed: 150, current: 150, status: "PAPER TRADING", lastSignal: "Awaiting first signal...", color: "#A78BFA", spark: flat(150) },
];

export const MILESTONES = [
  { label: "1K", value: 1_000 },
  { label: "10K", value: 10_000 },
  { label: "50K", value: 50_000 },
  { label: "100K", value: 100_000 },
  { label: "500K", value: 500_000 },
  { label: "1M", value: 1_000_000 },
];

export const SEED_LOG_LINES = [
  "🔍 Research Agent — Scanning Twitter/X for hype signals...",
  "📚 Pattern Agent — Loading 2Y historical BTC data...",
  "🛡️ Risk Agent — Portfolio exposure check: OK",
  "🧠 Orchestrator — All agents nominal. Paper trading mode active.",
  "📡 Market Feed — Connected to 6 venues (binance, nasdaq, omx, oanda)",
  "🤖 Sentinel Agent — Volatility regime: NORMAL",
  "🔭 Scout Agent — 47 tickers under watch across nordic universe",
  "⚙️  Execution Agent — Latency 12ms — channel healthy",
  "🧪 Backtest Agent — Replaying 30d window on BTC/SEK strategy v3.1",
  "🛰️  Macro Agent — FOMC calendar pulled — no events next 24h",
];

export const MOCK_TRADES = [
  { time: "12:31:04", market: "SWING CRYPTO", asset: "BTC/SEK", action: "BUY", entry: 612340, current: 614210, pnl: 1.21 },
  { time: "12:28:55", market: "NORDIC STOCKS", asset: "EVO.ST", action: "BUY", entry: 821.5, current: 819.8, pnl: -0.21 },
  { time: "12:18:11", market: "FOREX", asset: "EUR/SEK", action: "SELL", entry: 11.412, current: 11.398, pnl: 0.12 },
];
