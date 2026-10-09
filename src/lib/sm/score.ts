// Pure: Invo-style score 1–10, caps, copy-eligibility filters and tier.
import type { Metrics } from "./positions";

const bandUp = (v: number, th: number[], top = 10) => { for (let i = 0; i < th.length; i++) if (v >= th[i]) return top - i; return null; };

/** Profitability band for a window. th = thresholds for scores 10..5 (last is 0). */
export function profitScore(ret: number | null, th: number[]): number {
  if (ret == null) return 1;
  if (ret >= 0) return bandUp(ret, th) ?? 5;
  const step = th[th.length - 2]; // e.g. 1.5 for 30d
  if (ret >= -step) return 4;
  if (ret >= -2 * step) return 3;
  if (ret >= -3 * step) return 2;
  return 1;
}
export const PROFIT_TH = { 30: [7.5, 6, 4.5, 3, 1.5, 0], 90: [22.5, 18, 13.5, 9, 4.5, 0], 180: [45, 36, 27, 18, 9, 0] };

export function riskScore(ret: number | null, mdd: number | null): number {
  if (ret == null || ret < 0) return 1;
  if (!mdd || mdd <= 0) return 10;
  return Math.min(10, 2 + Math.floor(ret / mdd / 0.25));
}

export const CONS_TH = { 30: [100, 85, 75, 65, 50, 40, 30, 20, 10], 90: [85, 75, 70, 60, 50, 40, 30, 20, 10], 180: [80, 70, 65, 55, 50, 40, 30, 20, 10] };
export function consistencyScore(pct: number | null, th: number[]): number {
  if (pct == null) return 1;
  return bandUp(pct, th) ?? 1;
}

export function trackScore(age: number): number {
  const th: [number, number][] = [[180, 10], [120, 9], [90, 8], [60, 7], [30, 6], [21, 5], [14, 4], [7, 3], [3, 2]];
  for (const [d, s] of th) if (age >= d) return s;
  return 1;
}

const cat = (a: number, b: number, c: number) => 0.3 * a + 0.4 * b + 0.3 * c;

export type ScoreResult = {
  score: number; base: number; cap: number; tier: "A" | "B" | null; eligible: boolean; fast: boolean;
  filters: Record<string, boolean>; components: Record<string, number>;
};

export function scoreWallet(m: Metrics, nowMs: number): ScoreResult {
  const P = cat(profitScore(m.ret_30, PROFIT_TH[30]), profitScore(m.ret_90, PROFIT_TH[90]), profitScore(m.ret_180, PROFIT_TH[180]));
  const R = cat(riskScore(m.ret_30, m.mdd_30), riskScore(m.ret_90, m.mdd_90), riskScore(m.ret_180, m.mdd_180));
  const C = cat(consistencyScore(m.wweeks_30, CONS_TH[30]), consistencyScore(m.wweeks_90, CONS_TH[90]), consistencyScore(m.wweeks_180, CONS_TH[180]));
  const T = trackScore(m.age_days);
  const base = 0.4 * P + 0.3 * R + 0.2 * C + 0.1 * T;

  const caps: number[] = [T];
  const n = m.trades;
  if (n < 50) caps.push(7); else if (n < 60) caps.push(7.5); else if (n < 75) caps.push(8); else if (n < 90) caps.push(9);
  const w = m.active_weeks;
  if (w < 4) caps.push(6); else if (w < 6) caps.push(7); else if (w < 8) caps.push(8); else if (w < 12) caps.push(9); else if (w < 18) caps.push(9.5);
  const t1 = m.top1_share ?? 0, t4 = m.top4_share ?? 0;
  if (t1 >= 80) caps.push(4); else if (t1 >= 65) caps.push(5); else if (t1 >= 50) caps.push(6);
  if (t4 >= 80) caps.push(5); else if (t4 >= 65) caps.push(6); else if (t4 >= 50) caps.push(7);
  const d30 = m.mdd_30 ?? 0, d90 = m.mdd_90 ?? 0, d180 = m.mdd_180 ?? 0;
  if (d30 > 50) caps.push(4); else if (d30 > 40) caps.push(5); else if (d30 > 35) caps.push(6); else if (d30 > 30) caps.push(7);
  if (d90 > 70) caps.push(4); else if (d90 > 60) caps.push(5); else if (d90 > 50) caps.push(6); else if (d90 > 40) caps.push(7);
  if (d180 > 70) caps.push(6); else if (d180 > 60) caps.push(7); else if (d180 > 50) caps.push(8);
  const neg30 = (m.ret_30 ?? 0) < 0, neg90 = (m.ret_90 ?? 0) < 0, neg180 = (m.ret_180 ?? 0) < 0;
  if (neg30) caps.push(8.5);
  if (neg90 || neg180) caps.push(7.5);
  if (neg30 && neg90) caps.push(5);
  if ((m.lifetime_pnl ?? 0) < 0) caps.push(3);
  const cap = Math.min(...caps);
  const score = Math.max(1, Math.round(Math.min(base, cap) * 100) / 100);

  const fast = m.median_hold_h != null && m.median_hold_h < 24;
  const filters = {
    accuracy: (m.win_rate ?? 0) >= 50 && (m.profit_factor ?? 0) >= 1.5,
    swing_hold: m.median_hold_h != null && m.median_hold_h >= 24,
    leverage_liq: m.avg_lev != null && m.avg_lev <= 10 && m.liquidations === 0,
    min_trades: n >= 50,
    recent: m.last_trade_at != null && nowMs - m.last_trade_at <= 14 * 86400_000,
    liquid: (m.liquid_share ?? 0) >= 70,
  };
  const eligible = Object.values(filters).every(Boolean);
  const tier = eligible && score >= 8 ? "A" : eligible && score >= 7 ? "B" : null;
  return { score, base: Math.round(base * 100) / 100, cap, tier, eligible, fast, filters, components: { profitability: P, risk: R, consistency: C, track: T } };
}
