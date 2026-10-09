-- Coins traded by graded, non-high-frequency wallets: the copy backtest syncs hourly candles for these.
CREATE OR REPLACE FUNCTION public.sm_copy_coins(p_min_trades int)
RETURNS TABLE(coin text, trades bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.coin, count(*) FROM public.sm_trades t JOIN public.sm_scores s USING (address)
  WHERE NOT s.fast GROUP BY t.coin HAVING count(*) >= p_min_trades ORDER BY count(*) DESC LIMIT 80;
$$;
REVOKE ALL ON FUNCTION public.sm_copy_coins(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_copy_coins(int) TO service_role;
