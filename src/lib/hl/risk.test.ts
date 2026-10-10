import { describe, it, expect } from "vitest";
import { evaluateEntry, sizePosition, type DeskCfg, type EntryInput } from "./risk";

const cfg: DeskCfg = {
  budget_sek: 600, usd_sek: 10, risk_pct: 1.5, max_risk_pct: 2, max_open: 2, min_order_usd: 10,
  fee_pct: 0.045, slip_pct: 0.05, daily_loss_pct: 3, weekly_loss_pct: 6, kill_drawdown_pct: 15,
  night_rule: true, mode: "paper", kill_switch: false,
};
// 12:00 UTC = 14:00 Stockholm (CEST)
const base: EntryInput = {
  cfg, now: new Date("2026-07-01T12:00:00Z"), coin: "SOL", side: "long", ref_px: 100, stop_px: 90, mark: 100,
  crowding_flag: false, open_real: [], realized_net_usd: 0, day_net_usd: 0, week_net_usd: 0, peak_equity_usd: 60,
};
const reason = (x: Partial<EntryInput>) => { const r = evaluateEntry({ ...base, ...x }); return r.ok ? "ok" : r.reason; };

describe("paper desk risk rules", () => {
  it("rejects new entries 00:00-07:00 Stockholm", () => {
    expect(reason({ now: new Date("2026-07-01T04:30:00Z") })).toMatch(/night/); // 06:30 Stockholm
    expect(reason({ now: new Date("2026-07-01T05:00:00Z") })).not.toMatch(/night/); // 07:00
  });
  it("rejects at max_open 2", () => {
    expect(reason({ open_real: [{ margin_usd: 1 }, { margin_usd: 1 }] })).toMatch(/max open/);
  });
  it("daily loss 3% blocks", () => {
    expect(reason({ realized_net_usd: -1.8, day_net_usd: -1.8 })).toMatch(/daily/); // 1.8 >= 3% of 58.2
  });
  it("drawdown 15% from peak engages kill switch", () => {
    const r = evaluateEntry({ ...base, realized_net_usd: -10, peak_equity_usd: 60 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kill).toBe(true);
  });
  it("rejects when price moved > 0.5R toward target", () => {
    expect(reason({ mark: 105.1 })).toMatch(/0.5R/);
    expect(reason({ mark: 89 })).toMatch(/beyond the stop/);
  });
  it("min order rounds up to $10 only when risk <= 2%", () => {
    // equity $60, 1.5% = $0.90 risk; 10% stop -> $9 notional -> round to $10 -> $1.00 risk = 1.67% <= 2%
    const r = evaluateEntry({ ...base, mark: 100 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.notional_usd).toBe(10);
    // 30% stop: $10 risks ~$3 = 5% > 2%
    expect(reason({ stop_px: 70, mark: 100 })).toMatch(/max 2%/);
  });
  it("shadow positions skip the minimum order so blocked trades still get an outcome", () => {
    // 30% stop: the real desk refuses ($10 minimum would risk 5%), the shadow sizes at the normal 1.5% risk.
    expect(sizePosition(cfg, "SOL", "long", 100, 70, 60, 0).ok).toBe(false);
    const z = sizePosition(cfg, "SOL", "long", 100, 70, 60, 0, true);
    expect(z.ok).toBe(true);
    if (z.ok) expect(z.risk_usd).toBeCloseTo(0.9, 6);
  });
  it("leverage cap 5x BTC, 3x others", () => {
    const b = evaluateEntry({ ...base, coin: "BTC", stop_px: 99, ref_px: 100 });
    const s = evaluateEntry({ ...base, coin: "SOL", stop_px: 99, ref_px: 100 });
    expect(b.ok && b.leverage).toBe(5);
    expect(s.ok && s.leverage).toBe(3);
  });
});
