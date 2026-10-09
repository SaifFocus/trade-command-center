-- Deep-dive queue priority. 13,000+ Invo wallets pass the 30-fill floor, far more than the rate budget can grade,
-- and most are copiers (Mimic). Grade every leaderboard candidate, plus Invo wallets that either originate trades
-- (>= 30% of their opens start a cluster) or are very active (>= 300 fills), each with at least 10 opens.
CREATE OR REPLACE FUNCTION public.sm_due_wallets(p_limit int)
RETURNS TABLE(address text, first_seen timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT w.address, w.first_seen FROM public.sm_wallets w
  WHERE w.next_due_at <= now()
    AND ('leaderboard' = ANY(w.sources)
         OR (coalesce(w.invo_opens_60d, 0) >= 10 AND (coalesce(w.invo_originator_share, 0) >= 0.3 OR coalesce(w.invo_fills_60d, 0) >= 300)))
  ORDER BY ('leaderboard' = ANY(w.sources)) DESC, coalesce(w.invo_originator_share, 0) DESC, w.next_due_at
  LIMIT greatest(1, least(p_limit, 100));
$$;
CREATE OR REPLACE FUNCTION public.sm_due_count()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FROM public.sm_wallets w
  WHERE w.next_due_at <= now()
    AND ('leaderboard' = ANY(w.sources)
         OR (coalesce(w.invo_opens_60d, 0) >= 10 AND (coalesce(w.invo_originator_share, 0) >= 0.3 OR coalesce(w.invo_fills_60d, 0) >= 300)));
$$;
REVOKE ALL ON FUNCTION public.sm_due_wallets(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sm_due_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_due_wallets(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.sm_due_count() TO service_role;
