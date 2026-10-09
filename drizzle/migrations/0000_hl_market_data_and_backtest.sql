CREATE TABLE public.hl_universe (
  coin text NOT NULL, day_ntl_vlm numeric, open_interest numeric, funding numeric, mark_px numeric, max_leverage int,
  snapshot_at timestamptz NOT NULL, PRIMARY KEY (coin, snapshot_at));
CREATE TABLE public.hl_candles (
  coin text NOT NULL, "interval" text NOT NULL, t timestamptz NOT NULL,
  o numeric, h numeric, l numeric, c numeric, v numeric, PRIMARY KEY (coin, "interval", t));
CREATE TABLE public.hl_funding (
  coin text NOT NULL, t timestamptz NOT NULL, rate numeric, premium numeric, PRIMARY KEY (coin, t));
CREATE TABLE public.backtest_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(),
  params jsonb, status text, summary jsonb, error text);
CREATE TABLE public.backtest_trades (
  id bigserial PRIMARY KEY, run_id uuid REFERENCES public.backtest_runs(id) ON DELETE CASCADE,
  coin text, setup text, side text, sample text, entry_t timestamptz, entry_px numeric, stop_px numeric,
  t1_px numeric, t2_px numeric, exit_t timestamptz, exit_px numeric, exit_reason text,
  gross_r numeric, fee_r numeric, funding_r numeric, net_r numeric, bars_held int);
CREATE INDEX backtest_trades_run_idx ON public.backtest_trades(run_id);

GRANT SELECT ON public.hl_universe, public.hl_candles, public.hl_funding, public.backtest_runs, public.backtest_trades TO anon, authenticated;
GRANT ALL ON public.hl_universe, public.hl_candles, public.hl_funding, public.backtest_runs, public.backtest_trades TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.backtest_trades_id_seq TO service_role;

ALTER TABLE public.hl_universe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hl_candles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hl_funding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backtest_trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read hl_universe" ON public.hl_universe FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read hl_candles" ON public.hl_candles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read hl_funding" ON public.hl_funding FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read backtest_runs" ON public.backtest_runs FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "read backtest_trades" ON public.backtest_trades FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.hl_latest_t(p_coin text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    '4h', (SELECT max(t) FROM hl_candles WHERE coin = p_coin AND "interval" = '4h'),
    '1d', (SELECT max(t) FROM hl_candles WHERE coin = p_coin AND "interval" = '1d'),
    'funding', (SELECT max(t) FROM hl_funding WHERE coin = p_coin));
$$;

CREATE OR REPLACE FUNCTION public.hl_backtest_data(p_coin text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'c4h', (SELECT coalesce(jsonb_agg(jsonb_build_array((extract(epoch FROM t)*1000)::bigint, o, h, l, c, v) ORDER BY t), '[]'::jsonb)
            FROM hl_candles WHERE coin = p_coin AND "interval" = '4h'),
    'c1d', (SELECT coalesce(jsonb_agg(jsonb_build_array((extract(epoch FROM t)*1000)::bigint, o, h, l, c, v) ORDER BY t), '[]'::jsonb)
            FROM hl_candles WHERE coin = p_coin AND "interval" = '1d'),
    'f4h', (SELECT coalesce(jsonb_agg(jsonb_build_array(b, s, n) ORDER BY b), '[]'::jsonb) FROM (
              SELECT (floor(extract(epoch FROM t)/14400)*14400000)::bigint AS b, sum(rate) AS s, count(*) AS n
              FROM hl_funding WHERE coin = p_coin GROUP BY 1) x));
$$;
REVOKE EXECUTE ON FUNCTION public.hl_latest_t(text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.hl_backtest_data(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hl_latest_t(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.hl_backtest_data(text) TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;