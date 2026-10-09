-- Phase 2: live execution engine. Same lockdown as every other table:
-- owner-only SELECT for authenticated, no client writes, service_role does all writes.

ALTER TABLE public.desk_config
  ADD COLUMN IF NOT EXISTS live_armed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS live_armed_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_start_equity_usd numeric,
  ADD COLUMN IF NOT EXISTS live_whitelist text[] NOT NULL DEFAULT ARRAY['BTC','ETH','SOL'],
  ADD COLUMN IF NOT EXISTS live_setups text[] NOT NULL DEFAULT ARRAY['pullback_long','breakout_retest_long','breakdown_retest_short','crowded_long_squeeze_short'],
  ADD COLUMN IF NOT EXISTS live_min_volume_usd numeric NOT NULL DEFAULT 10000000,
  ADD COLUMN IF NOT EXISTS max_entries_per_day int NOT NULL DEFAULT 6,
  ADD COLUMN IF NOT EXISTS smoke_test_passed_at timestamptz,
  ADD COLUMN IF NOT EXISTS smoke_test_result jsonb,
  ADD COLUMN IF NOT EXISTS live_trip_streak int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS live_trip_reason text,
  ADD COLUMN IF NOT EXISTS live_last_reconcile_at timestamptz,
  ADD COLUMN IF NOT EXISTS live_fills_cursor_ms bigint,
  ADD COLUMN IF NOT EXISTS live_lock_owner text,
  ADD COLUMN IF NOT EXISTS live_lock_until timestamptz;

ALTER TABLE public.signals ADD COLUMN IF NOT EXISTS live_note text;

CREATE TABLE IF NOT EXISTS public.live_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES public.signals(id) ON DELETE SET NULL,
  paper_position_id uuid REFERENCES public.paper_positions(id) ON DELETE SET NULL,
  network text NOT NULL CHECK (network IN ('mainnet','testnet')),
  coin text NOT NULL,
  side text NOT NULL CHECK (side IN ('long','short')),
  setup text NOT NULL,
  status text NOT NULL DEFAULT 'opening' CHECK (status IN ('opening','open','closing','closed','error','missed')),
  entry_t timestamptz NOT NULL DEFAULT now(),
  entry_px numeric,
  init_size numeric,
  size numeric NOT NULL DEFAULT 0,
  notional_usd numeric,
  leverage numeric,
  risk_usd numeric,
  init_stop_px numeric NOT NULL,
  stop_px numeric NOT NULL,
  t1_px numeric,
  t2_px numeric,
  be_moved boolean NOT NULL DEFAULT false,
  t1_done boolean NOT NULL DEFAULT false,
  sl_oid bigint,
  t1_oid bigint,
  t2_oid bigint,
  exit_t timestamptz,
  exit_px numeric,
  close_reason text,
  realized_pnl_usd numeric,
  fees_usd numeric,
  funding_usd numeric,
  net_usd numeric,
  usd_sek_at_entry numeric,
  usd_sek_at_exit numeric,
  note text,
  close_attempts int NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS live_positions_status_idx ON public.live_positions (status, entry_t);
-- At most one active live position per coin: also stops a double entry if two execute passes overlap.
CREATE UNIQUE INDEX IF NOT EXISTS live_positions_one_active_per_coin ON public.live_positions (coin) WHERE status IN ('opening','open','closing');
GRANT SELECT ON public.live_positions TO authenticated;
GRANT ALL ON public.live_positions TO service_role;
ALTER TABLE public.live_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_select ON public.live_positions;
CREATE POLICY owner_select ON public.live_positions FOR SELECT TO authenticated USING (public.is_owner());

CREATE TABLE IF NOT EXISTS public.live_orders (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  position_id uuid REFERENCES public.live_positions(id) ON DELETE SET NULL,
  kind text NOT NULL,
  coin text NOT NULL,
  is_buy boolean NOT NULL,
  px numeric,
  size numeric,
  trigger_px numeric,
  reduce_only boolean NOT NULL,
  oid bigint,
  cloid text,
  status text NOT NULL,
  error text,
  raw jsonb,
  network text NOT NULL,
  dry_run boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS live_orders_pos_idx ON public.live_orders (position_id, created_at);
GRANT SELECT ON public.live_orders TO authenticated;
GRANT ALL ON public.live_orders TO service_role;
GRANT USAGE ON SEQUENCE public.live_orders_id_seq TO service_role;
ALTER TABLE public.live_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_select ON public.live_orders;
CREATE POLICY owner_select ON public.live_orders FOR SELECT TO authenticated USING (public.is_owner());

CREATE TABLE IF NOT EXISTS public.live_fills (
  tid bigint PRIMARY KEY,
  oid bigint,
  position_id uuid REFERENCES public.live_positions(id) ON DELETE SET NULL,
  coin text NOT NULL,
  side text NOT NULL,
  dir text,
  px numeric NOT NULL,
  sz numeric NOT NULL,
  fee numeric NOT NULL DEFAULT 0,
  fee_token text,
  closed_pnl numeric NOT NULL DEFAULT 0,
  time timestamptz NOT NULL,
  hash text,
  network text NOT NULL,
  raw jsonb
);
CREATE INDEX IF NOT EXISTS live_fills_time_idx ON public.live_fills (time);
CREATE INDEX IF NOT EXISTS live_fills_pos_idx ON public.live_fills (position_id);
GRANT SELECT ON public.live_fills TO authenticated;
GRANT ALL ON public.live_fills TO service_role;
ALTER TABLE public.live_fills ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_select ON public.live_fills;
CREATE POLICY owner_select ON public.live_fills FOR SELECT TO authenticated USING (public.is_owner());

CREATE TABLE IF NOT EXISTS public.live_equity (
  id bigserial PRIMARY KEY,
  t timestamptz NOT NULL DEFAULT now(),
  account_value_usd numeric NOT NULL,
  withdrawable_usd numeric,
  unrealized_usd numeric,
  expected_usd numeric,
  note text
);
GRANT SELECT ON public.live_equity TO authenticated;
GRANT ALL ON public.live_equity TO service_role;
GRANT USAGE ON SEQUENCE public.live_equity_id_seq TO service_role;
ALTER TABLE public.live_equity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_select ON public.live_equity;
CREATE POLICY owner_select ON public.live_equity FOR SELECT TO authenticated USING (public.is_owner());

-- Clients never write to live tables (Supabase's default privileges would otherwise grant it; RLS blocks rows anyway).
REVOKE ALL ON public.live_positions, public.live_orders, public.live_fills, public.live_equity FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.live_positions, public.live_orders, public.live_fills, public.live_equity FROM authenticated;
REVOKE ALL ON SEQUENCE public.live_orders_id_seq, public.live_equity_id_seq FROM anon, authenticated;

-- Lease shared by executeLive and reconcileLive (service_role only): returns true when acquired.
CREATE OR REPLACE FUNCTION public.live_lock(p_owner text, p_seconds int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE public.desk_config
     SET live_lock_owner = p_owner, live_lock_until = now() + make_interval(secs => greatest(1, least(p_seconds, 600)))
   WHERE id = 1 AND (live_lock_until IS NULL OR live_lock_until < now() OR live_lock_owner = p_owner);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n = 1;
END $$;
CREATE OR REPLACE FUNCTION public.live_unlock(p_owner text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.desk_config SET live_lock_owner = NULL, live_lock_until = NULL WHERE id = 1 AND live_lock_owner = p_owner;
$$;
REVOKE ALL ON FUNCTION public.live_lock(text, int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.live_unlock(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.live_lock(text, int) TO service_role;
GRANT EXECUTE ON FUNCTION public.live_unlock(text) TO service_role;

-- Reconcile every 2 minutes (a no-op until secrets exist and live is armed, a position is open, or the kill switch is on).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'live-reconcile';
SELECT cron.schedule('live-reconcile', '*/2 * * * *', $cron$
  select net.http_post(
    url := 'https://apextradyr.lovable.app/api/cron/live-reconcile',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_private where name='hl_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$cron$);
