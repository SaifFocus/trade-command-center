-- Owner-scouted Invo traders (2026-10-12): real-money Invo portfolios matched to their Hyperliquid wallets.
-- They are tagged 'invo_scout' in sm_wallets.sources (display_name = Invo username), always watched as practice wallets
-- (paper only) and always copied by the Mimic simulator. The grading queue must accept them like leaderboard wallets.
CREATE OR REPLACE FUNCTION public.sm_due_wallets(p_limit integer)
RETURNS TABLE(address text, first_seen timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH due AS (
    SELECT w.*, (coalesce(w.invo_opens_60d, 0) >= 10 AND (coalesce(w.invo_originator_share, 0) >= 0.3 OR coalesce(w.invo_fills_60d, 0) >= 300)) AS invo_ok
    FROM public.sm_wallets w
    WHERE w.next_due_at <= now()
  )
  SELECT d.address, d.first_seen FROM due d
  WHERE 'leaderboard' = ANY(d.sources) OR 'invo_scout' = ANY(d.sources) OR d.invo_ok
  ORDER BY EXISTS (SELECT 1 FROM public.sm_scores s WHERE s.address = d.address AND s.watchlist) DESC,
           ('invo_scout' = ANY(d.sources)) DESC,
           d.invo_ok DESC,
           -- swing-paced traders (10-59 opens in 60 days) before the very active ones, who are almost all scalpers
           CASE WHEN coalesce(d.invo_opens_60d, 0) < 60 THEN 0 WHEN d.invo_opens_60d < 120 THEN 1 WHEN d.invo_opens_60d < 300 THEN 2 ELSE 3 END,
           coalesce(d.invo_originator_share, 0) DESC,
           d.next_due_at
  LIMIT greatest(1, least(p_limit, 100));
$function$;
REVOKE ALL ON FUNCTION public.sm_due_wallets(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_due_wallets(int) TO service_role;
