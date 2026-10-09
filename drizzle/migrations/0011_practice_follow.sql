-- Practice follows (paper only): watchlist wallets below the full A/B bar; their opens become 'practice_follow' signals.
ALTER TABLE public.sm_scores ADD COLUMN IF NOT EXISTS practice boolean NOT NULL DEFAULT false;
-- Set on a watched wallet's first snapshot; existing positions at that moment are a baseline, not follow signals.
ALTER TABLE public.sm_scores ADD COLUMN IF NOT EXISTS tracked_at timestamptz;
UPDATE public.desk_config SET enabled_setups = array_append(enabled_setups, 'practice_follow')
WHERE id = 1 AND NOT ('practice_follow' = ANY(enabled_setups));

-- Grading queue: watched wallets first (daily re-grade), then Invo traders (originators before copiers, most active first),
-- then the Hyperliquid leaderboard, which is mostly high-frequency bots.
CREATE OR REPLACE FUNCTION public.sm_due_wallets(p_limit integer)
RETURNS TABLE(address text, first_seen timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH due AS (
    SELECT w.*, (coalesce(w.invo_opens_60d, 0) >= 10 AND (coalesce(w.invo_originator_share, 0) >= 0.3 OR coalesce(w.invo_fills_60d, 0) >= 300)) AS invo_ok
    FROM public.sm_wallets w
    WHERE w.next_due_at <= now()
  )
  SELECT d.address, d.first_seen FROM due d
  WHERE 'leaderboard' = ANY(d.sources) OR d.invo_ok
  ORDER BY EXISTS (SELECT 1 FROM public.sm_scores s WHERE s.address = d.address AND s.watchlist) DESC,
           d.invo_ok DESC,
           (coalesce(d.invo_originator_share, 0) >= 0.5) DESC,
           coalesce(d.invo_opens_60d, 0) DESC,
           d.next_due_at
  LIMIT greatest(1, least(p_limit, 100));
$function$;
REVOKE ALL ON FUNCTION public.sm_due_wallets(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_due_wallets(int) TO service_role;
