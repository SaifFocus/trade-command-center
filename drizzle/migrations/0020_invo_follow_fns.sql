-- Weekly Invo re-scout (2026-10-13): the scheduled "APEX Invo re-scout" agent adds and drops scouted Invo traders only
-- through these two functions (service_role only, like submit_review). Paper only: scouted wallets never trade real money.
-- p_address is a matched Hyperliquid wallet ('0x' + 40 hex) or an Invo portfolio followed through the bridge
-- ('invo:' + portfolio uuid). At most 30 scouted traders (SCOUT_SLOTS in deep.server.ts).

CREATE OR REPLACE FUNCTION public.invo_follow_set(p_address text, p_username text, p_note text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  a text := lower(trim(p_address));
  is_bridge boolean;
  n int;
  existed boolean;
BEGIN
  IF a ~ '^0x[0-9a-f]{40}$' THEN is_bridge := false;
  ELSIF a ~ '^invo:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN is_bridge := true;
  ELSE RAISE EXCEPTION 'address must be 0x + 40 hex or invo:<portfolio uuid>';
  END IF;
  IF p_username IS NULL OR p_username !~ '^[A-Za-z0-9_.-]{1,40}$' THEN RAISE EXCEPTION 'username must be the Invo username'; END IF;
  SELECT EXISTS (SELECT 1 FROM sm_wallets WHERE address = a AND 'invo_scout' = ANY(sources)) INTO existed;
  IF NOT existed THEN
    SELECT count(*) INTO n FROM sm_wallets WHERE 'invo_scout' = ANY(sources);
    IF n >= 30 THEN RETURN 'full: 30 scouted traders already, drop one first'; END IF;
  END IF;
  INSERT INTO sm_wallets(address, sources, display_name, status, next_due_at)
  VALUES (a, CASE WHEN is_bridge THEN ARRAY['invo_scout','invo_bridge'] ELSE ARRAY['invo_scout'] END,
          p_username || ' · ' || left(coalesce(p_note, ''), 80),
          CASE WHEN is_bridge THEN 'tracked' ELSE 'pending' END,
          CASE WHEN is_bridge THEN now() + interval '100 years' ELSE now() END)
  ON CONFLICT (address) DO UPDATE SET
    sources = ARRAY(SELECT DISTINCT x FROM unnest(sm_wallets.sources || EXCLUDED.sources) x),
    display_name = EXCLUDED.display_name;
  INSERT INTO sm_scores(address, score, watchlist, practice, mirror) VALUES (a, 0, true, true, true)
  ON CONFLICT (address) DO UPDATE SET watchlist = true, practice = CASE WHEN sm_scores.tier IS NULL THEN true ELSE sm_scores.practice END, mirror = true;
  RETURN CASE WHEN existed THEN 'updated' ELSE 'added' END;
END $$;

CREATE OR REPLACE FUNCTION public.invo_follow_drop(p_address text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a text := lower(trim(p_address));
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sm_wallets WHERE address = a AND 'invo_scout' = ANY(sources)) THEN RETURN 'not scouted'; END IF;
  UPDATE sm_wallets SET sources = array_remove(array_remove(sources, 'invo_scout'), 'invo_bridge') WHERE address = a;
  -- Invo pseudo-wallets leave every list now; real wallets are re-ranked by the next watchlist rebuild.
  IF a LIKE 'invo:%' THEN UPDATE sm_scores SET watchlist = false, practice = false, mirror = false WHERE address = a; END IF;
  RETURN 'dropped';
END $$;

REVOKE ALL ON FUNCTION public.invo_follow_set(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invo_follow_drop(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invo_follow_set(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.invo_follow_drop(text) TO service_role;
