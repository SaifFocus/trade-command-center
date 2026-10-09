-- FALLBACK ONLY: apply if the Hyperliquid copy backtest gate fails (Saif, 2026-10-09).
-- Adds Coinversa Pulse as a scout candidate source. Not applied; tested once and rolled back.
-- After applying, an agent with the Coinversa connector feeds wallets via sm_add_candidates(); the deep dive grades
-- them from Hyperliquid data. Also add "coinversa" to sourceOf() in copy-engine.ts and the scout page badges/filter.

-- Coinversa Pulse as a third scout candidate source. The scheduled review agent reads Coinversa through its
-- connector and hands wallets over with sm_add_candidates(); the deep dive then grades them from Hyperliquid's
-- own data like any other candidate. Coinversa's numbers are kept for display only and never enter a score.
ALTER TABLE public.sm_wallets ADD COLUMN IF NOT EXISTS coinversa jsonb;

CREATE OR REPLACE FUNCTION public.sm_add_candidates(p_rows jsonb)
RETURNS TABLE(added int, updated int, skipped int)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r jsonb; addr text; meta jsonb; existed boolean;
  a int := 0; u int := 0; s int := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) > 1000 THEN
    RAISE EXCEPTION 'p_rows must be a JSON array of at most 1000 objects';
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    addr := lower(coalesce(r->>'address', ''));
    IF jsonb_typeof(r) <> 'object' OR addr !~ '^0x[0-9a-f]{40}$' THEN s := s + 1; CONTINUE; END IF;
    -- Keep only short scalar fields; anything else is dropped.
    SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) INTO meta
    FROM jsonb_each(r - 'address')
    WHERE key ~ '^[a-zA-Z_]{1,32}$' AND jsonb_typeof(value) IN ('string', 'number', 'boolean') AND length(value::text) <= 80;
    meta := meta || jsonb_build_object('seen_at', now());
    existed := EXISTS (SELECT 1 FROM public.sm_wallets WHERE address = addr);
    INSERT INTO public.sm_wallets (address, sources, coinversa) VALUES (addr, ARRAY['coinversa'], meta)
    ON CONFLICT (address) DO UPDATE SET
      sources = CASE WHEN 'coinversa' = ANY(public.sm_wallets.sources) THEN public.sm_wallets.sources
                     ELSE public.sm_wallets.sources || 'coinversa'::text END,
      coinversa = EXCLUDED.coinversa;
    IF existed THEN u := u + 1; ELSE a := a + 1; END IF;
  END LOOP;
  RETURN QUERY SELECT a, u, s;
END;
$$;
REVOKE ALL ON FUNCTION public.sm_add_candidates(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_add_candidates(jsonb) TO service_role;

-- Queue order: leaderboard, then Coinversa, then qualifying Invo wallets.
CREATE OR REPLACE FUNCTION public.sm_due_wallets(p_limit integer)
RETURNS TABLE(address text, first_seen timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  SELECT w.address, w.first_seen FROM public.sm_wallets w
  WHERE w.next_due_at <= now()
    AND ('leaderboard' = ANY(w.sources) OR 'coinversa' = ANY(w.sources)
         OR (coalesce(w.invo_opens_60d, 0) >= 10 AND (coalesce(w.invo_originator_share, 0) >= 0.3 OR coalesce(w.invo_fills_60d, 0) >= 300)))
  ORDER BY ('leaderboard' = ANY(w.sources)) DESC, ('coinversa' = ANY(w.sources)) DESC, coalesce(w.invo_originator_share, 0) DESC, w.next_due_at
  LIMIT greatest(1, least(p_limit, 100));
$function$;

CREATE OR REPLACE FUNCTION public.sm_due_count()
RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*) FROM public.sm_wallets w
  WHERE w.next_due_at <= now()
    AND ('leaderboard' = ANY(w.sources) OR 'coinversa' = ANY(w.sources)
         OR (coalesce(w.invo_opens_60d, 0) >= 10 AND (coalesce(w.invo_originator_share, 0) >= 0.3 OR coalesce(w.invo_fills_60d, 0) >= 300)));
$$;
REVOKE ALL ON FUNCTION public.sm_due_wallets(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sm_due_count() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_due_wallets(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.sm_due_count() TO service_role;
