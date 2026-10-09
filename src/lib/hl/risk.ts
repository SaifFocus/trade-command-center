// Paper-desk risk manager. Pure (no I/O) so every rule is unit-testable.
export type DeskCfg = {
  budget_sek: number; usd_sek: number; risk_pct: number; max_risk_pct: number; max_open: number;
  min_order_usd: number; fee_pct: number; slip_pct: number; daily_loss_pct: number; weekly_loss_pct: number;
  kill_drawdown_pct: number; night_rule: boolean; mode: string; kill_switch: boolean;
};

export type EntryInput = {
  cfg: DeskCfg; now: Date; coin: string; side: "long" | "short";
  ref_px: number; stop_px: number; mark: number; crowding_flag: boolean;
  open_real: { margin_usd: number }[];
  realized_net_usd: number; day_net_usd: number; week_net_usd: number; peak_equity_usd: number;
};

export type Sized = { entry: number; R: number; t1: number; t2: number; size_coin: number; notional_usd: number; margin_usd: number; leverage: number; risk_usd: number };
export type EntryResult = ({ ok: true } & Sized) | { ok: false; reason: string; kill?: boolean };

export function stockholmHour(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Stockholm", hour: "numeric", hourCycle: "h23" }).format(d));
}

export function equityUsd(cfg: DeskCfg, realizedNet: number) {
  return cfg.budget_sek / cfg.usd_sek + realizedNet;
}

export const leverageCap = (coin: string) => (coin === "BTC" || coin === "ETH" ? 5 : 3);

/** Fill at mark ± slippage, size by risk_pct of equity, apply min order / max risk / margin rules. */
export function sizePosition(cfg: DeskCfg, coin: string, side: "long" | "short", mark: number, stop: number, equity: number, usedMargin: number): ({ ok: true } & Sized) | { ok: false; reason: string } {
  const dir = side === "long" ? 1 : -1;
  const entry = mark * (1 + (dir * cfg.slip_pct) / 100);
  const R = Math.abs(entry - stop);
  if (dir * (entry - stop) <= 0) return { ok: false, reason: "fill price is beyond the stop" };
  const stopDist = R / entry;
  let risk = (equity * cfg.risk_pct) / 100;
  let notional = risk / stopDist;
  if (notional < cfg.min_order_usd) {
    notional = cfg.min_order_usd;
    risk = notional * stopDist;
    if (risk > (equity * cfg.max_risk_pct) / 100)
      return { ok: false, reason: `min order $${cfg.min_order_usd} would risk ${((risk / equity) * 100).toFixed(2)}% > max ${cfg.max_risk_pct}%` };
  }
  const leverage = leverageCap(coin);
  const margin = notional / leverage;
  const free = equity - usedMargin;
  if (margin > free) return { ok: false, reason: `margin $${margin.toFixed(2)} exceeds free equity $${free.toFixed(2)}` };
  return { ok: true, entry, R, t1: entry + dir * 1.5 * R, t2: entry + dir * 3 * R, size_coin: notional / entry, notional_usd: notional, margin_usd: margin, leverage, risk_usd: risk };
}

export function evaluateEntry(x: EntryInput): EntryResult {
  const { cfg } = x;
  if (cfg.kill_switch) return { ok: false, reason: "kill switch is on" };
  // Paper keeps trading while live is armed (mode 'live'); the live desk follows the paper fills.
  if (cfg.mode !== "paper" && cfg.mode !== "live") return { ok: false, reason: `mode is '${cfg.mode}', not 'paper' or 'live'` };
  if (cfg.night_rule && stockholmHour(x.now) < 7) return { ok: false, reason: "night rule: no new entries 00:00-07:00 Stockholm" };
  if (x.crowding_flag) return { ok: false, reason: `reviewer flagged crowding on the ${x.side} side` };
  if (x.open_real.length >= cfg.max_open) return { ok: false, reason: `max open positions (${cfg.max_open}) reached` };
  const equity = equityUsd(cfg, x.realized_net_usd);
  if (-x.day_net_usd >= (equity * cfg.daily_loss_pct) / 100) return { ok: false, reason: `daily loss limit ${cfg.daily_loss_pct}% reached` };
  if (-x.week_net_usd >= (equity * cfg.weekly_loss_pct) / 100) return { ok: false, reason: `weekly loss limit ${cfg.weekly_loss_pct}% reached` };
  const peak = Math.max(x.peak_equity_usd, equity);
  if (peak > 0 && ((peak - equity) / peak) * 100 >= cfg.kill_drawdown_pct)
    return { ok: false, reason: `drawdown from peak >= ${cfg.kill_drawdown_pct}% — kill switch engaged`, kill: true };
  const dir = x.side === "long" ? 1 : -1;
  const sigR = Math.abs(x.ref_px - x.stop_px);
  if (dir * (x.mark - x.stop_px) <= 0) return { ok: false, reason: "price is already beyond the stop" };
  if (dir * (x.mark - x.ref_px) > 0.5 * sigR) return { ok: false, reason: "price moved more than 0.5R toward the target" };
  const used = x.open_real.reduce((a, p) => a + p.margin_usd, 0);
  return sizePosition(cfg, x.coin, x.side, x.mark, x.stop_px, equity, used);
}
