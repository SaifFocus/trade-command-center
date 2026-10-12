-- Invo bridge (2026-10-13): a program on the owner's computer keeps a browser logged into Invo, opens each followed Invo
-- portfolio and posts the JSON the Invo app downloaded to /api/invo/ingest (authenticated by its own secret; only the
-- secret's SHA-256 is stored, in app_private 'invo_bridge_secret_sha256'). Followed portfolios are pseudo-wallets
-- 'invo:<portfolio id>' in sm_wallets with sources 'invo_scout' + 'invo_bridge'. Paper only.

CREATE TABLE IF NOT EXISTS public.invo_bridge_runs (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  version text,
  host text,
  visited int NOT NULL DEFAULT 0,
  parsed int NOT NULL DEFAULT 0,
  positions int NOT NULL DEFAULT 0,
  events int NOT NULL DEFAULT 0,
  logged_out boolean NOT NULL DEFAULT false,
  problems jsonb
);
CREATE INDEX IF NOT EXISTS invo_bridge_runs_at_idx ON public.invo_bridge_runs (at DESC);

-- Last unreadable visit per portfolio, kept so the parser can be fixed against real responses.
CREATE TABLE IF NOT EXISTS public.invo_bridge_raw (
  portfolio_id text PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  final_url text,
  note text,
  payload jsonb
);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['invo_bridge_runs', 'invo_bridge_raw'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS owner_select ON public.%I', t);
    EXECUTE format('CREATE POLICY owner_select ON public.%I FOR SELECT TO authenticated USING (public.is_owner())', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.invo_bridge_runs_id_seq TO service_role;

-- Old bridge rounds are only health history: keep two days.
CREATE OR REPLACE FUNCTION public.invo_bridge_prune() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  DELETE FROM public.invo_bridge_runs WHERE at < now() - interval '2 days';
$$;
REVOKE ALL ON FUNCTION public.invo_bridge_prune() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invo_bridge_prune() TO service_role;

-- Grading queue: only real Hyperliquid wallets (Invo pseudo-wallets have no on-chain history to grade).
CREATE OR REPLACE FUNCTION public.sm_due_wallets(p_limit integer)
RETURNS TABLE(address text, first_seen timestamp with time zone)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH due AS (
    SELECT w.*, (coalesce(w.invo_opens_60d, 0) >= 10 AND (coalesce(w.invo_originator_share, 0) >= 0.3 OR coalesce(w.invo_fills_60d, 0) >= 300)) AS invo_ok
    FROM public.sm_wallets w
    WHERE w.next_due_at <= now() AND w.address LIKE '0x%'
  )
  SELECT d.address, d.first_seen FROM due d
  WHERE 'leaderboard' = ANY(d.sources) OR 'invo_scout' = ANY(d.sources) OR d.invo_ok
  ORDER BY EXISTS (SELECT 1 FROM public.sm_scores s WHERE s.address = d.address AND s.watchlist) DESC,
           ('invo_scout' = ANY(d.sources)) DESC,
           d.invo_ok DESC,
           CASE WHEN coalesce(d.invo_opens_60d, 0) < 60 THEN 0 WHEN d.invo_opens_60d < 120 THEN 1 WHEN d.invo_opens_60d < 300 THEN 2 ELSE 3 END,
           coalesce(d.invo_originator_share, 0) DESC,
           d.next_due_at
  LIMIT greatest(1, least(p_limit, 100));
$function$;
REVOKE ALL ON FUNCTION public.sm_due_wallets(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sm_due_wallets(int) TO service_role;
