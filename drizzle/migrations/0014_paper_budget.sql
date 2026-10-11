-- Paper desk sizes from its own USD budget; budget_sek stays the live desk's cap.
ALTER TABLE public.desk_config ADD COLUMN IF NOT EXISTS paper_budget_usd numeric;
ALTER TABLE public.desk_config DROP CONSTRAINT IF EXISTS desk_config_paper_budget_usd_check;
ALTER TABLE public.desk_config ADD CONSTRAINT desk_config_paper_budget_usd_check
  CHECK (paper_budget_usd IS NULL OR (paper_budget_usd >= 10 AND paper_budget_usd <= 1000));
UPDATE public.desk_config SET paper_budget_usd = 100 WHERE id = 1;
