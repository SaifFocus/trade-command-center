CREATE TABLE public.desk_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  budget_sek numeric NOT NULL DEFAULT 600,
  usd_sek numeric,
  usd_sek_updated_at timestamptz,
  risk_pct numeric NOT NULL DEFAULT 1.5,
  max_risk_pct numeric NOT NULL DEFAULT 2.0,
  max_open int NOT NULL DEFAULT 2,
  min_order_usd numeric NOT NULL DEFAULT 10,
  fee_pct numeric NOT NULL DEFAULT 0.045,
  slip_pct numeric NOT NULL DEFAULT 0.05,
  daily_loss_pct numeric NOT NULL DEFAULT 3,
  weekly_loss_pct numeric NOT NULL DEFAULT 6,
  kill_drawdown_pct numeric NOT NULL DEFAULT 15,
  night_rule boolean NOT NULL DEFAULT true,
  enabled_setups text[] NOT NULL DEFAULT ARRAY['pullback_long','breakout_retest_long','breakdown_retest_short','crowded_long_squeeze_short'],
  mode text NOT NULL DEFAULT 'paper',
  kill_switch boolean NOT NULL DEFAULT false,
  review_window_minutes int NOT NULL DEFAULT 40,
  updated_at timestamptz DEFAULT now()
);
GRANT SELECT ON public.desk_config TO authenticated;
GRANT ALL ON public.desk_config TO service_role;
ALTER TABLE public.desk_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_select ON public.desk_config FOR SELECT TO authenticated USING (public.is_owner());

CREATE TABLE public.signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  coin text NOT NULL,
  setup text NOT NULL,
  side text NOT NULL CHECK (side IN ('long','short')),
  signal_bar_t timestamptz NOT NULL,
  ref_px numeric NOT NULL,
  stop_px numeric NOT NULL,
  t1_px numeric NOT NULL,
  t2_px numeric NOT NULL,
  stop_dist_pct numeric NOT NULL,
  regime text,
  context jsonb,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','approved','vetoed','expired','rejected_by_risk','executed')),
  review jsonb,
  reviewed_at timestamptz,
  risk_note text
);
CREATE INDEX signals_status_idx ON public.signals (status, created_at);
GRANT SELECT ON public.signals TO authenticated;
GRANT ALL ON public.signals TO service_role;
ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_select ON public.signals FOR SELECT TO authenticated USING (public.is_owner());

CREATE TABLE public.paper_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES public.signals(id) ON DELETE SET NULL,
  shadow boolean NOT NULL DEFAULT false,
  coin text NOT NULL,
  side text NOT NULL,
  setup text NOT NULL,
  entry_t timestamptz NOT NULL,
  entry_px numeric NOT NULL,
  init_stop_px numeric NOT NULL,
  size_coin numeric NOT NULL,
  notional_usd numeric NOT NULL,
  margin_usd numeric NOT NULL,
  leverage numeric NOT NULL,
  risk_usd numeric NOT NULL,
  stop_px numeric NOT NULL,
  t1_px numeric NOT NULL,
  t2_px numeric NOT NULL,
  t1_hit boolean NOT NULL DEFAULT false,
  remaining_frac numeric NOT NULL DEFAULT 1,
  bars_held int NOT NULL DEFAULT 0,
  last_bar_t timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  exit_t timestamptz,
  exit_px numeric,
  exit_reason text,
  gross_usd numeric NOT NULL DEFAULT 0,
  fees_usd numeric NOT NULL DEFAULT 0,
  funding_usd numeric NOT NULL DEFAULT 0,
  net_usd numeric,
  net_r numeric
);
CREATE INDEX paper_positions_status_idx ON public.paper_positions (status, shadow);
GRANT SELECT ON public.paper_positions TO authenticated;
GRANT ALL ON public.paper_positions TO service_role;
ALTER TABLE public.paper_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_select ON public.paper_positions FOR SELECT TO authenticated USING (public.is_owner());

CREATE TABLE public.paper_equity (
  id bigserial PRIMARY KEY,
  t timestamptz NOT NULL DEFAULT now(),
  equity_usd numeric NOT NULL,
  open_risk_usd numeric NOT NULL DEFAULT 0,
  note text
);
GRANT SELECT ON public.paper_equity TO authenticated;
GRANT ALL ON public.paper_equity TO service_role;
GRANT USAGE ON SEQUENCE public.paper_equity_id_seq TO service_role;
ALTER TABLE public.paper_equity ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_select ON public.paper_equity FOR SELECT TO authenticated USING (public.is_owner());

INSERT INTO public.desk_config (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.submit_review(p_signal_id uuid, p_decision text, p_confidence int, p_crowding_flag boolean, p_notes jsonb)
RETURNS public.signals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.signals;
  win int;
BEGIN
  IF p_decision IS NULL OR p_decision NOT IN ('approve','veto') THEN
    RAISE EXCEPTION 'submit_review: decision must be ''approve'' or ''veto'' (got %)', p_decision;
  END IF;
  IF p_confidence IS NULL OR p_confidence < 0 OR p_confidence > 100 THEN
    RAISE EXCEPTION 'submit_review: confidence must be 0-100 (got %)', p_confidence;
  END IF;
  SELECT review_window_minutes INTO win FROM public.desk_config WHERE id = 1;
  SELECT * INTO s FROM public.signals WHERE id = p_signal_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'submit_review: signal % not found', p_signal_id;
  END IF;
  IF s.status <> 'new' THEN
    RAISE EXCEPTION 'submit_review: signal % has status %, only ''new'' can be reviewed', p_signal_id, s.status;
  END IF;
  IF s.created_at < now() - make_interval(mins => coalesce(win, 40)) THEN
    RAISE EXCEPTION 'submit_review: review window of % minutes has passed for signal %', coalesce(win, 40), p_signal_id;
  END IF;
  UPDATE public.signals SET
    status = CASE WHEN p_decision = 'approve' THEN 'approved' ELSE 'vetoed' END,
    review = jsonb_build_object('decision', p_decision, 'confidence', p_confidence,
      'crowding_flag', coalesce(p_crowding_flag, false), 'notes', coalesce(p_notes, '{}'::jsonb), 'reviewer', 'claude'),
    reviewed_at = now()
  WHERE id = p_signal_id
  RETURNING * INTO s;
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public.submit_review(uuid, text, int, boolean, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_review(uuid, text, int, boolean, jsonb) TO service_role;