CREATE TABLE public.app_owner (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  claimed_at timestamptz DEFAULT now()
);
REVOKE ALL ON public.app_owner FROM anon, authenticated;
GRANT ALL ON public.app_owner TO service_role;
ALTER TABLE public.app_owner ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_owner() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_owner WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_owner() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_owner() TO authenticated, service_role;

DROP POLICY IF EXISTS public_all ON public.markets;
DROP POLICY IF EXISTS public_all ON public.trades;
DROP POLICY IF EXISTS public_all ON public.portfolio_snapshots;
DROP POLICY IF EXISTS public_all ON public.agent_logs;
DROP POLICY IF EXISTS public_all ON public.milestones;
DROP POLICY IF EXISTS "read hl_universe" ON public.hl_universe;
DROP POLICY IF EXISTS "read hl_candles" ON public.hl_candles;
DROP POLICY IF EXISTS "read hl_funding" ON public.hl_funding;
DROP POLICY IF EXISTS "read backtest_runs" ON public.backtest_runs;
DROP POLICY IF EXISTS "read backtest_trades" ON public.backtest_trades;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['markets','trades','portfolio_snapshots','agent_logs','milestones','hl_universe','hl_candles','hl_funding','backtest_runs','backtest_trades'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY owner_select ON public.%I FOR SELECT TO authenticated USING (public.is_owner())', t);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.hl_latest_t(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.hl_backtest_data(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hl_latest_t(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hl_backtest_data(text) TO service_role;

-- Private server-side settings (cron token). No client grants, no policies.
CREATE TABLE public.app_private (
  name text PRIMARY KEY,
  value text NOT NULL
);
REVOKE ALL ON public.app_private FROM anon, authenticated;
GRANT ALL ON public.app_private TO service_role;
ALTER TABLE public.app_private ENABLE ROW LEVEL SECURITY;
INSERT INTO public.app_private(name, value)
  VALUES ('hl_cron_secret', encode(extensions.gen_random_bytes(32), 'hex'))
  ON CONFLICT (name) DO NOTHING;

CREATE OR REPLACE FUNCTION public.verify_cron_secret(p_token text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_token IS NOT NULL AND length(p_token) >= 32 AND EXISTS (
    SELECT 1 FROM public.app_private WHERE name = 'hl_cron_secret' AND value = p_token);
$$;
REVOKE ALL ON FUNCTION public.verify_cron_secret(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_secret(text) TO service_role;