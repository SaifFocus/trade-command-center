CREATE OR REPLACE FUNCTION public.sm_coin_hourly(p_coin text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    'c1h', (SELECT coalesce(jsonb_agg(jsonb_build_array((extract(epoch FROM t)*1000)::bigint, o, h, l, c) ORDER BY t), '[]'::jsonb)
            FROM hl_candles WHERE coin = p_coin AND "interval" = '1h'),
    'c1d', (SELECT coalesce(jsonb_agg(jsonb_build_array((extract(epoch FROM t)*1000)::bigint, o, h, l, c) ORDER BY t), '[]'::jsonb)
            FROM hl_candles WHERE coin = p_coin AND "interval" = '1d'),
    'f1h', (SELECT coalesce(jsonb_agg(jsonb_build_array((floor(extract(epoch FROM t)/3600)*3600000)::bigint, rate) ORDER BY t), '[]'::jsonb)
            FROM hl_funding WHERE coin = p_coin));
$$;
REVOKE ALL ON FUNCTION public.sm_coin_hourly(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_coin_hourly(text) TO service_role;

CREATE OR REPLACE FUNCTION public.sm_latest_t(p_coin text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT jsonb_build_object(
    '1h', (SELECT max(t) FROM hl_candles WHERE coin = p_coin AND "interval" = '1h'),
    '1d', (SELECT max(t) FROM hl_candles WHERE coin = p_coin AND "interval" = '1d'),
    'funding', (SELECT max(t) FROM hl_funding WHERE coin = p_coin));
$$;
REVOKE ALL ON FUNCTION public.sm_latest_t(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_latest_t(text) TO service_role;