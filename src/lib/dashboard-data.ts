export type Market = {
  id: string;
  name: string;
  emoji: string;
  seed: number;
  current: number;
  status: "SCANNING" | "PAPER TRADING" | string;
  lastSignal: string;
  color: string;
  spark: { v: number }[];
};

export type LogEntry = {
  id: number;
  t: string;
  message: string;
  agent: string;
  level: string;
  market_id: string | null;
};

export type MilestoneRow = {
  id: number;
  label: string;
  value: number;
  reached_at: string | null;
};

export type TradeRow = {
  id: string;
  time: string;
  market: string;
  asset: string;
  action: string;
  entry: number;
  current: number;
  pnl: number;
  status: string;
  mode: string;
};

// Static fallback milestones (used only if DB is empty)
export const MILESTONES: { label: string; value: number }[] = [
  { label: "1K", value: 1_000 },
  { label: "10K", value: 10_000 },
  { label: "50K", value: 50_000 },
  { label: "100K", value: 100_000 },
  { label: "500K", value: 500_000 },
  { label: "1M", value: 1_000_000 },
];

// Default color/emoji per market id (fallback when DB row lacks them)
export const MARKET_DEFAULTS: Record<string, { color: string; emoji: string }> = {
  hype:   { color: "#FF3CAC", emoji: "🚀" },
  swing:  { color: "#F7931A", emoji: "📈" },
  us:     { color: "#00D4FF", emoji: "🏛️" },
  nordic: { color: "#00FF88", emoji: "🇸🇪" },
  meme:   { color: "#FFFF00", emoji: "🐸" },
  forex:  { color: "#A78BFA", emoji: "💱" },
};
