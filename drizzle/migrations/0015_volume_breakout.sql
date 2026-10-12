-- Paper-only risk overrides (live keeps risk_pct / max_open) and a cap on open positions per side.
ALTER TABLE public.desk_config ADD COLUMN IF NOT EXISTS paper_risk_pct numeric;
ALTER TABLE public.desk_config ADD COLUMN IF NOT EXISTS paper_max_open integer;
ALTER TABLE public.desk_config ADD COLUMN IF NOT EXISTS paper_max_same_side integer;
ALTER TABLE public.desk_config DROP CONSTRAINT IF EXISTS desk_config_paper_risk_check;
ALTER TABLE public.desk_config ADD CONSTRAINT desk_config_paper_risk_check CHECK (
  (paper_risk_pct IS NULL OR (paper_risk_pct > 0 AND paper_risk_pct <= 2))
  AND (paper_max_open IS NULL OR (paper_max_open BETWEEN 1 AND 10))
  AND (paper_max_same_side IS NULL OR (paper_max_same_side BETWEEN 1 AND 10)));

-- volume_breakout joins the paper setups; breakdown_retest_short leaves them (negative in both halves of the
-- uncapped 2024-2026 backtest). Paper at $100: 1% risk, up to 6 open, at most 3 on one side (raised to 10 and 5 in 0017).
UPDATE public.desk_config SET
  enabled_setups = array_append(array_remove(array_remove(enabled_setups, 'breakdown_retest_short'), 'volume_breakout'), 'volume_breakout'),
  paper_risk_pct = 1.0, paper_max_open = 6, paper_max_same_side = 3
WHERE id = 1;
