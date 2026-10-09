CREATE OR REPLACE FUNCTION public.sm_invo_agg2(p_since date, p_min integer)
RETURNS TABLE(address text, fills bigint, opens bigint, originated bigint)
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT address, sum(fills), sum(opens), sum(originated) FROM public.sm_invo_daily
  WHERE day >= p_since GROUP BY address HAVING sum(fills) >= p_min ORDER BY address;
$$;
REVOKE ALL ON FUNCTION public.sm_invo_agg2(date, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_invo_agg2(date, integer) TO service_role;