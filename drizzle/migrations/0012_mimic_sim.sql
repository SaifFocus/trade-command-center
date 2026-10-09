-- Mimic simulator (paper only): $100 virtual copies of active Invo traders' positions, opened a few minutes after they
-- open and closed when they close. Separate from the paper desk: no review, no risk rules, own table.
ALTER TABLE public.sm_scores ADD COLUMN IF NOT EXISTS mirror boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.mimic_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  address text NOT NULL,
  coin text NOT NULL,
  side text NOT NULL CHECK (side IN ('long', 'short')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  entry_px numeric NOT NULL,
  their_entry_px numeric,
  their_leverage numeric,
  notional_usd numeric NOT NULL,
  closed_at timestamptz,
  exit_px numeric,
  exit_reason text,
  fees_usd numeric NOT NULL DEFAULT 0,
  net_usd numeric,
  net_pct numeric
);
CREATE INDEX IF NOT EXISTS mimic_trades_open_idx ON public.mimic_trades (address, coin) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS mimic_trades_opened_idx ON public.mimic_trades (opened_at DESC);

GRANT SELECT ON public.mimic_trades TO authenticated;
GRANT ALL ON public.mimic_trades TO service_role;
ALTER TABLE public.mimic_trades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_select ON public.mimic_trades;
CREATE POLICY owner_select ON public.mimic_trades FOR SELECT TO authenticated USING (public.is_owner());
REVOKE ALL ON public.mimic_trades FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.mimic_trades FROM authenticated;
