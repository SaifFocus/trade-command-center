CREATE TABLE public.sm_wallets (
  address text PRIMARY KEY,
  sources text[] NOT NULL DEFAULT '{}',
  display_name text,
  first_seen timestamptz NOT NULL DEFAULT now(),
  account_value numeric,
  lb_month_vlm numeric,
  lb_alltime_pnl numeric,
  invo_fills_60d integer NOT NULL DEFAULT 0,
  invo_opens_60d integer NOT NULL DEFAULT 0,
  invo_originator_share numeric,
  last_deep_dive_at timestamptz,
  next_due_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  error text
);
CREATE INDEX sm_wallets_due ON public.sm_wallets (next_due_at);

CREATE TABLE public.sm_invo_daily (
  day date NOT NULL,
  address text NOT NULL,
  fills integer NOT NULL DEFAULT 0,
  opens integer NOT NULL DEFAULT 0,
  originated integer NOT NULL DEFAULT 0,
  PRIMARY KEY (day, address)
);
CREATE TABLE public.sm_invo_days (
  day date PRIMARY KEY,
  rows integer NOT NULL,
  status text NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sm_trades (
  id bigserial PRIMARY KEY,
  address text NOT NULL,
  coin text NOT NULL,
  side text NOT NULL,
  entry_t timestamptz NOT NULL,
  exit_t timestamptz NOT NULL,
  entry_px numeric,
  exit_px numeric,
  max_notional numeric,
  net_pnl numeric NOT NULL,
  fees numeric,
  hold_h numeric,
  liquidated boolean NOT NULL DEFAULT false
);
CREATE INDEX sm_trades_addr ON public.sm_trades (address, entry_t);

CREATE TABLE public.sm_wallet_stats (
  address text PRIMARY KEY,
  computed_at timestamptz NOT NULL DEFAULT now(),
  ret_30 numeric, ret_90 numeric, ret_180 numeric,
  mdd_30 numeric, mdd_90 numeric, mdd_180 numeric,
  wweeks_30 numeric, wweeks_90 numeric, wweeks_180 numeric,
  active_weeks integer, trades integer, win_rate numeric, win_loss numeric, profit_factor numeric, expectancy numeric,
  top1_share numeric, top4_share numeric, median_hold_h numeric, p25_hold_h numeric,
  avg_lev numeric, max_lev numeric, liquidations integer, last_trade_at timestamptz, liquid_share numeric,
  age_days numeric, lifetime_pnl numeric, account_value numeric,
  portfolio jsonb,
  metrics jsonb
);

CREATE TABLE public.sm_scores (
  address text PRIMARY KEY,
  computed_at timestamptz NOT NULL DEFAULT now(),
  score numeric NOT NULL,
  base numeric,
  cap numeric,
  tier text,
  eligible boolean NOT NULL DEFAULT false,
  fast boolean NOT NULL DEFAULT false,
  watchlist boolean NOT NULL DEFAULT false,
  filters jsonb,
  components jsonb
);
CREATE INDEX sm_scores_score ON public.sm_scores (score DESC);

CREATE TABLE public.sm_positions (
  address text NOT NULL,
  coin text NOT NULL,
  side text NOT NULL,
  szi numeric NOT NULL,
  entry_px numeric,
  notional numeric,
  leverage numeric,
  account_value numeric,
  opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (address, coin)
);

CREATE TABLE public.sm_events (
  id bigserial PRIMARY KEY,
  t timestamptz NOT NULL DEFAULT now(),
  address text NOT NULL,
  coin text NOT NULL,
  side text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('open','increase','reduce','close')),
  size numeric,
  entry_px numeric,
  leverage numeric,
  notional_frac numeric,
  processed boolean NOT NULL DEFAULT false
);
CREATE INDEX sm_events_t ON public.sm_events (t DESC);

CREATE TABLE public.sm_jobs (
  name text PRIMARY KEY,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rate_budget (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  window_start timestamptz NOT NULL DEFAULT now(),
  used integer NOT NULL DEFAULT 0,
  cap integer NOT NULL DEFAULT 800
);
INSERT INTO public.rate_budget (id) VALUES (1);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['sm_wallets','sm_invo_daily','sm_invo_days','sm_trades','sm_wallet_stats','sm_scores','sm_positions','sm_events','sm_jobs','rate_budget'] LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY owner_select ON public.%I FOR SELECT TO authenticated USING (public.is_owner())', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.sm_trades_id_seq, public.sm_events_id_seq TO service_role;

-- Shared token bucket: reserve p weight in the current 60s window. Returns 0 when granted, else ms to wait.
CREATE OR REPLACE FUNCTION public.take_weight(p integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.rate_budget;
BEGIN
  SELECT * INTO r FROM public.rate_budget WHERE id = 1 FOR UPDATE;
  IF r.window_start < now() - interval '60 seconds' THEN
    UPDATE public.rate_budget SET window_start = now(), used = p WHERE id = 1;
    RETURN 0;
  END IF;
  IF r.used + p <= r.cap OR r.used = 0 THEN
    UPDATE public.rate_budget SET used = used + p WHERE id = 1;
    RETURN 0;
  END IF;
  RETURN greatest(50, (extract(epoch FROM (r.window_start + interval '60 seconds' - now())) * 1000)::int);
END $$;
REVOKE ALL ON FUNCTION public.take_weight(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_weight(integer) TO service_role;

-- Aggregate Invo activity over the last 60 days of ingested files.
CREATE OR REPLACE FUNCTION public.sm_invo_agg(p_since date)
RETURNS TABLE(address text, fills bigint, opens bigint, originated bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT address, sum(fills), sum(opens), sum(originated) FROM public.sm_invo_daily WHERE day >= p_since GROUP BY address;
$$;
REVOKE ALL ON FUNCTION public.sm_invo_agg(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_invo_agg(date) TO service_role;

ALTER TABLE public.paper_positions ADD COLUMN IF NOT EXISTS follow_wallets text[];
ALTER TABLE public.desk_config ALTER COLUMN enabled_setups SET DEFAULT ARRAY['pullback_long','breakout_retest_long','breakdown_retest_short','crowded_long_squeeze_short','smart_money_follow']::text[];