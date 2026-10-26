-- FX paper desk (2026-10-26): two paper books ('sprint', 'steady') on Hyperliquid xyz (HIP-3) perps, traded by the
-- owner's Claude scheduled task through service_role-only SQL functions. Paper only: nothing here places orders.
-- Formulas (sizing, isolated liquidation price, close accounting) mirror the pure TS in src/lib/fx/fx.ts.

CREATE TABLE IF NOT EXISTS public.fx_books (
  id text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'busted')),
  attempt int NOT NULL DEFAULT 1,
  start_sek numeric NOT NULL DEFAULT 150,
  target_sek numeric NOT NULL DEFAULT 1000,
  start_usd numeric NOT NULL,
  cash_usd numeric NOT NULL,
  max_leverage numeric NOT NULL,
  max_risk_pct numeric NOT NULL,
  max_open int NOT NULL,
  daily_loss_pct numeric,
  fee_pct numeric NOT NULL DEFAULT 0.09,
  slip_pct numeric NOT NULL DEFAULT 0.02,
  allowed_coins text[] NOT NULL DEFAULT ARRAY['xyz:EUR','xyz:JPY','xyz:GBP','xyz:GOLD','xyz:SILVER'],
  created_at timestamptz NOT NULL DEFAULT now(),
  reset_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.fx_quotes (
  coin text PRIMARY KEY,
  mid numeric NOT NULL,
  mark numeric,
  funding_rate numeric,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.fx_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book text NOT NULL REFERENCES public.fx_books(id),
  attempt int NOT NULL,
  signal_ref text,
  coin text NOT NULL,
  side text NOT NULL CHECK (side IN ('long', 'short')),
  opened_at timestamptz NOT NULL DEFAULT now(),
  entry_px numeric NOT NULL,
  size numeric NOT NULL,
  notional_usd numeric NOT NULL,
  leverage numeric NOT NULL,
  margin_usd numeric NOT NULL,
  risk_usd numeric NOT NULL,
  stop_px numeric NOT NULL,
  init_stop_px numeric NOT NULL,
  target_px numeric,
  liq_px numeric NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at timestamptz,
  exit_px numeric,
  exit_reason text CHECK (exit_reason IN ('stop', 'target', 'liquidation', 'manual', 'weekend')),
  fees_usd numeric NOT NULL DEFAULT 0,
  funding_usd numeric NOT NULL DEFAULT 0,
  net_usd numeric,
  net_r numeric,
  thesis text,
  last_checked_at timestamptz
);
CREATE INDEX IF NOT EXISTS fx_positions_book_idx ON public.fx_positions (book, status, opened_at DESC);

CREATE TABLE IF NOT EXISTS public.fx_equity (
  id bigserial PRIMARY KEY,
  book text NOT NULL REFERENCES public.fx_books(id),
  attempt int NOT NULL,
  t timestamptz NOT NULL DEFAULT now(),
  equity_usd numeric NOT NULL
);
CREATE INDEX IF NOT EXISTS fx_equity_book_idx ON public.fx_equity (book, t);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['fx_books', 'fx_quotes', 'fx_positions', 'fx_equity'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS owner_select ON public.%I', t);
    EXECUTE format('CREATE POLICY owner_select ON public.%I FOR SELECT TO authenticated USING (public.is_owner())', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.fx_equity_id_seq TO service_role;

INSERT INTO public.fx_books (id, name, start_usd, cash_usd, max_leverage, max_risk_pct, max_open, daily_loss_pct)
SELECT v.id, v.name, round(150 / d.usd_sek, 4), round(150 / d.usd_sek, 4), v.lev, v.risk, v.mo, v.dl
FROM (VALUES ('sprint', 'Sprint', 20::numeric, 10::numeric, 2, NULL::numeric),
             ('steady', 'Steady', 5::numeric, 1::numeric, 3, 3::numeric)) v(id, name, lev, risk, mo, dl)
CROSS JOIN (SELECT coalesce(usd_sek, 10) AS usd_sek FROM public.desk_config WHERE id = 1
            UNION ALL SELECT 10 WHERE NOT EXISTS (SELECT 1 FROM public.desk_config WHERE id = 1)) d
ON CONFLICT (id) DO NOTHING;

-- Helpers ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fx__mmr(p_coin text) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_coin IN ('xyz:GOLD', 'xyz:SILVER') THEN 0.025 ELSE 0.01 END $$;
CREATE OR REPLACE FUNCTION public.fx__coin_max_lev(p_coin text) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_coin IN ('xyz:GOLD', 'xyz:SILVER') THEN 20 ELSE 50 END::numeric $$;
-- Slippage in percent: the book's rate, at least 0.05% on thin xyz:GBP.
CREATE OR REPLACE FUNCTION public.fx__slip(p_coin text, p_slip numeric) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_coin = 'xyz:GBP' THEN greatest(p_slip, 0.05) ELSE p_slip END $$;

-- Equity = realized cash + unrealized P&L at mid minus accrued funding; isolated, so a position never loses more than
-- its margin.
CREATE OR REPLACE FUNCTION public.fx_book_equity(p_book text) RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' AS $$
  SELECT b.cash_usd + coalesce((
    SELECT sum(greatest(CASE WHEN p.side = 'long' THEN 1 ELSE -1 END * (coalesce(q.mid, p.entry_px) - p.entry_px) * p.size
                        - p.funding_usd, -p.margin_usd))
    FROM fx_positions p LEFT JOIN fx_quotes q ON q.coin = p.coin
    WHERE p.book = b.id AND p.status = 'open'), 0)
  FROM fx_books b WHERE b.id = p_book $$;

-- Realized net P&L of the current attempt since midnight Europe/Stockholm.
CREATE OR REPLACE FUNCTION public.fx__realized_today(p_book text, p_attempt int) RETURNS numeric LANGUAGE sql STABLE
SET search_path TO 'public' AS $$
  SELECT coalesce(sum(net_usd), 0) FROM fx_positions
  WHERE book = p_book AND attempt = p_attempt AND status = 'closed'
    AND closed_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/Stockholm') AT TIME ZONE 'Europe/Stockholm') $$;

-- Closes a position at an already-slipped price. Entry fee was taken from cash at open, so cash gets net + entry fee.
-- Liquidation loses the whole margin plus fees.
CREATE OR REPLACE FUNCTION public.fx__close(p_id uuid, p_px numeric, p_reason text, p_t timestamptz)
RETURNS public.fx_positions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p fx_positions; b fx_books; exit_fee numeric; gross numeric; fees numeric; net numeric;
BEGIN
  SELECT * INTO p FROM fx_positions WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fx: position % not found', p_id; END IF;
  IF p.status <> 'open' THEN RAISE EXCEPTION 'fx: position % is already closed', p_id; END IF;
  SELECT * INTO b FROM fx_books WHERE id = p.book FOR UPDATE;
  exit_fee := p.size * p_px * b.fee_pct / 100;
  fees := p.fees_usd + exit_fee;
  IF p_reason = 'liquidation' THEN
    gross := -p.margin_usd;
    net := gross - fees;
  ELSE
    gross := CASE WHEN p.side = 'long' THEN 1 ELSE -1 END * (p_px - p.entry_px) * p.size;
    net := gross - fees - p.funding_usd;
  END IF;
  UPDATE fx_books SET cash_usd = cash_usd + net + p.fees_usd WHERE id = p.book;
  UPDATE fx_positions SET status = 'closed', closed_at = coalesce(p_t, now()), exit_px = p_px, exit_reason = p_reason,
    fees_usd = fees, net_usd = round(net, 6), net_r = CASE WHEN p.risk_usd > 0 THEN round(net / p.risk_usd, 4) END,
    last_checked_at = coalesce(p_t, now())
  WHERE id = p_id RETURNING * INTO p;
  RETURN p;
END $$;

-- Claude: open ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fx_open(p_book text, p_coin text, p_side text, p_stop_px numeric, p_target_px numeric,
  p_risk_pct numeric, p_leverage numeric, p_thesis text, p_signal_ref text DEFAULT NULL)
RETURNS public.fx_positions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b fx_books; q fx_quotes; loc timestamp; dow int; dir int; slip numeric; entry numeric; eq numeric;
  used numeric; risk numeric; dist numeric; sz numeric; notional numeric; lev numeric; cap numeric; mmr numeric;
  margin numeric; fee numeric; liq numeric; today numeric; r fx_positions;
BEGIN
  SELECT * INTO b FROM fx_books WHERE id = p_book FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fx_open: unknown book "%" (use sprint or steady)', p_book; END IF;
  IF b.status <> 'active' THEN RAISE EXCEPTION 'fx_open: book % is busted; no new trades until the owner resets it', p_book; END IF;
  IF p_coin IS NULL OR NOT (p_coin = ANY (b.allowed_coins)) THEN
    RAISE EXCEPTION 'fx_open: coin % is not allowed in book % (allowed: %)', p_coin, p_book, array_to_string(b.allowed_coins, ', ');
  END IF;
  IF p_side NOT IN ('long', 'short') THEN RAISE EXCEPTION 'fx_open: side must be long or short'; END IF;
  SELECT * INTO q FROM fx_quotes WHERE coin = p_coin;
  IF NOT FOUND OR q.updated_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'fx_open: quote for % is missing or older than 10 minutes', p_coin;
  END IF;
  loc := now() AT TIME ZONE 'Europe/Stockholm';
  dow := extract(isodow FROM loc);
  IF (dow = 5 AND loc::time >= '22:00') OR dow = 6 OR (dow = 7 AND loc::time < '23:00') THEN
    RAISE EXCEPTION 'fx_open: no new entries from Friday 22:00 to Sunday 23:00 Stockholm time';
  END IF;
  IF (SELECT count(*) FROM fx_positions WHERE book = p_book AND status = 'open') >= b.max_open THEN
    RAISE EXCEPTION 'fx_open: book % already has % open positions (max %)', p_book, b.max_open, b.max_open;
  END IF;
  IF EXISTS (SELECT 1 FROM fx_positions WHERE book = p_book AND coin = p_coin AND status = 'open') THEN
    RAISE EXCEPTION 'fx_open: book % already has an open % position', p_book, p_coin;
  END IF;
  dir := CASE WHEN p_side = 'long' THEN 1 ELSE -1 END;
  IF p_stop_px IS NULL OR p_stop_px <= 0 THEN RAISE EXCEPTION 'fx_open: stop price is required'; END IF;
  IF dir * (q.mid - p_stop_px) <= 0 THEN
    RAISE EXCEPTION 'fx_open: stop % must be % the mid % for a %', p_stop_px, CASE WHEN dir = 1 THEN 'below' ELSE 'above' END, q.mid, p_side;
  END IF;
  IF abs(q.mid - p_stop_px) / q.mid < 0.0005 THEN RAISE EXCEPTION 'fx_open: stop must be at least 0.05%% from the mid %', q.mid; END IF;
  IF p_target_px IS NOT NULL AND dir * (p_target_px - q.mid) <= 0 THEN
    RAISE EXCEPTION 'fx_open: target % must be % the mid % for a %', p_target_px, CASE WHEN dir = 1 THEN 'above' ELSE 'below' END, q.mid, p_side;
  END IF;
  IF p_risk_pct IS NULL OR p_risk_pct <= 0 THEN RAISE EXCEPTION 'fx_open: risk_pct must be positive'; END IF;
  IF p_leverage IS NULL OR p_leverage < 1 THEN RAISE EXCEPTION 'fx_open: leverage must be at least 1'; END IF;

  eq := fx_book_equity(p_book);
  IF eq <= 0 THEN RAISE EXCEPTION 'fx_open: book % has no equity', p_book; END IF;
  IF b.daily_loss_pct IS NOT NULL THEN
    today := fx__realized_today(p_book, b.attempt);
    IF today < 0 AND -today >= eq * b.daily_loss_pct / 100 THEN
      RAISE EXCEPTION 'fx_open: daily loss stop: realized % USD today is at least %%% of equity', round(today, 2), b.daily_loss_pct;
    END IF;
  END IF;

  slip := fx__slip(p_coin, b.slip_pct) / 100;
  entry := q.mid * (1 + dir * slip);
  mmr := fx__mmr(p_coin);
  lev := least(p_leverage, b.max_leverage, fx__coin_max_lev(p_coin));
  SELECT coalesce(sum(margin_usd), 0) INTO used FROM fx_positions WHERE book = p_book AND status = 'open';
  risk := eq * least(p_risk_pct, b.max_risk_pct) / 100;
  dist := abs(entry - p_stop_px);
  sz := risk / dist;
  notional := sz * entry;
  cap := greatest(eq - used, 0) * lev;
  IF notional > cap THEN notional := cap; sz := cap / entry; risk := sz * dist; END IF;
  IF notional < 10 THEN
    RAISE EXCEPTION 'fx_open: position would be $% notional, below Hyperliquid''s $10 minimum', round(notional, 2);
  END IF;
  margin := notional / lev;
  fee := notional * b.fee_pct / 100;
  liq := CASE WHEN dir = 1 THEN greatest((entry * sz - margin) / (sz * (1 - mmr)), 0)
              ELSE (entry * sz + margin) / (sz * (1 + mmr)) END;

  UPDATE fx_books SET cash_usd = cash_usd - fee WHERE id = p_book;
  INSERT INTO fx_positions (book, attempt, signal_ref, coin, side, entry_px, size, notional_usd, leverage, margin_usd,
    risk_usd, stop_px, init_stop_px, target_px, liq_px, fees_usd, thesis, last_checked_at)
  VALUES (p_book, b.attempt, p_signal_ref, p_coin, p_side, entry, sz, notional, lev, margin, risk, p_stop_px, p_stop_px,
    p_target_px, liq, fee, p_thesis, now())
  RETURNING * INTO r;
  RETURN r;
END $$;

-- Claude: close at mid with slippage and fee ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fx_close(p_position_id uuid, p_reason text DEFAULT 'manual')
RETURNS public.fx_positions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p fx_positions; q fx_quotes; b fx_books; px numeric;
BEGIN
  IF p_reason NOT IN ('manual', 'weekend') THEN RAISE EXCEPTION 'fx_close: reason must be manual or weekend'; END IF;
  SELECT * INTO p FROM fx_positions WHERE id = p_position_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'fx_close: position % not found', p_position_id; END IF;
  IF p.status <> 'open' THEN RAISE EXCEPTION 'fx_close: position % is already closed', p_position_id; END IF;
  SELECT * INTO q FROM fx_quotes WHERE coin = p.coin;
  IF NOT FOUND OR q.updated_at < now() - interval '10 minutes' THEN
    RAISE EXCEPTION 'fx_close: quote for % is missing or older than 10 minutes', p.coin;
  END IF;
  SELECT * INTO b FROM fx_books WHERE id = p.book;
  px := q.mid * (1 - CASE WHEN p.side = 'long' THEN 1 ELSE -1 END * fx__slip(p.coin, b.slip_pct) / 100);
  RETURN fx__close(p_position_id, px, p_reason, now());
END $$;

-- Claude: move stop / target -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fx_amend(p_position_id uuid, p_stop_px numeric, p_target_px numeric)
RETURNS public.fx_positions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p fx_positions; q fx_quotes; dir int;
BEGIN
  SELECT * INTO p FROM fx_positions WHERE id = p_position_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'fx_amend: position % not found', p_position_id; END IF;
  IF p.status <> 'open' THEN RAISE EXCEPTION 'fx_amend: position % is closed', p_position_id; END IF;
  SELECT * INTO q FROM fx_quotes WHERE coin = p.coin;
  IF NOT FOUND THEN RAISE EXCEPTION 'fx_amend: no quote for %', p.coin; END IF;
  dir := CASE WHEN p.side = 'long' THEN 1 ELSE -1 END;
  IF p_stop_px IS NULL OR p_stop_px <= 0 THEN RAISE EXCEPTION 'fx_amend: stop price is required'; END IF;
  IF dir * (q.mid - p_stop_px) <= 0 THEN
    RAISE EXCEPTION 'fx_amend: stop % must stay % the current mid %', p_stop_px, CASE WHEN dir = 1 THEN 'below' ELSE 'above' END, q.mid;
  END IF;
  IF p_target_px IS NOT NULL AND dir * (p_target_px - q.mid) <= 0 THEN
    RAISE EXCEPTION 'fx_amend: target % must be % the current mid %', p_target_px, CASE WHEN dir = 1 THEN 'above' ELSE 'below' END, q.mid;
  END IF;
  UPDATE fx_positions SET stop_px = p_stop_px, target_px = p_target_px WHERE id = p_position_id RETURNING * INTO p;
  RETURN p;
END $$;

-- Engine (cron route): settle one bar walk -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fx_settle(p_position_id uuid, p_funding_add numeric, p_checked_at timestamptz,
  p_exit_px numeric DEFAULT NULL, p_reason text DEFAULT NULL, p_closed_at timestamptz DEFAULT NULL)
RETURNS public.fx_positions LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p fx_positions;
BEGIN
  UPDATE fx_positions SET funding_usd = funding_usd + coalesce(p_funding_add, 0),
    last_checked_at = greatest(coalesce(last_checked_at, opened_at), p_checked_at)
  WHERE id = p_position_id AND status = 'open' RETURNING * INTO p;
  IF NOT FOUND THEN RAISE EXCEPTION 'fx_settle: open position % not found', p_position_id; END IF;
  IF p_exit_px IS NOT NULL THEN
    IF p_reason NOT IN ('stop', 'target', 'liquidation') THEN RAISE EXCEPTION 'fx_settle: bad reason %', p_reason; END IF;
    p := fx__close(p_position_id, p_exit_px, p_reason, p_closed_at);
  END IF;
  RETURN p;
END $$;

-- Engine: one equity row per book per hour; a book under $1 is busted.
CREATE OR REPLACE FUNCTION public.fx_snapshot() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b fx_books; eq numeric; out jsonb := '{}'::jsonb; wrote boolean;
BEGIN
  FOR b IN SELECT * FROM fx_books ORDER BY id FOR UPDATE LOOP
    eq := fx_book_equity(b.id);
    wrote := false;
    IF NOT EXISTS (SELECT 1 FROM fx_equity WHERE book = b.id AND attempt = b.attempt AND t >= date_trunc('hour', now())) THEN
      INSERT INTO fx_equity (book, attempt, equity_usd) VALUES (b.id, b.attempt, round(eq, 6));
      wrote := true;
    END IF;
    IF eq < 1 AND b.status = 'active' THEN UPDATE fx_books SET status = 'busted' WHERE id = b.id; b.status := 'busted'; END IF;
    out := out || jsonb_build_object(b.id, jsonb_build_object('equity_usd', round(eq, 2), 'status', b.status, 'wrote', wrote));
  END LOOP;
  RETURN out;
END $$;

-- Claude: context ------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fx__bars4h(p_coin text)
RETURNS TABLE (t timestamptz, o numeric, h numeric, l numeric, c numeric) LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT b, (array_agg(x.o ORDER BY x.t))[1], max(x.h), min(x.l), (array_agg(x.c ORDER BY x.t DESC))[1]
  FROM (SELECT date_bin('4 hours', k.t, timestamptz '1970-01-01') b, k.t, k.o, k.h, k.l, k.c
        FROM hl_candles k WHERE k.coin = p_coin AND k.interval = '1h' AND k.t > now() - interval '30 days') x
  GROUP BY b ORDER BY b $$;

CREATE OR REPLACE FUNCTION public.fx__atr14(p_coin text, p_interval text) RETURNS numeric LANGUAGE sql STABLE
SET search_path TO 'public' AS $$
  SELECT avg(greatest(h - l, abs(h - pc), abs(l - pc))) FROM (
    SELECT h, l, lag(c) OVER (ORDER BY t) pc FROM (
      SELECT t, h, l, c FROM hl_candles WHERE coin = p_coin AND interval = p_interval ORDER BY t DESC LIMIT 15) a) z
  WHERE pc IS NOT NULL $$;

-- % change from the 1h close at about now - p_ago to p_mid.
CREATE OR REPLACE FUNCTION public.fx__chg(p_coin text, p_mid numeric, p_ago interval) RETURNS numeric LANGUAGE sql STABLE
SET search_path TO 'public' AS $$
  SELECT round((p_mid / c - 1) * 100, 4) FROM hl_candles
  WHERE coin = p_coin AND interval = '1h' AND t + interval '1 hour' <= now() - p_ago AND c > 0
  ORDER BY t DESC LIMIT 1 $$;

CREATE OR REPLACE FUNCTION public.fx_context() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q fx_quotes; b fx_books; coins jsonb := '[]'::jsonb; books jsonb := '[]'::jsonb; fx numeric; eq numeric; bars jsonb;
  sma20 numeric; sma50 numeric; pos jsonb;
BEGIN
  SELECT usd_sek INTO fx FROM desk_config WHERE id = 1;
  FOR q IN SELECT * FROM fx_quotes ORDER BY coin LOOP
    SELECT avg(c) INTO sma20 FROM (SELECT c FROM fx__bars4h(q.coin) ORDER BY t DESC LIMIT 20) s;
    SELECT avg(c) INTO sma50 FROM (SELECT c FROM fx__bars4h(q.coin) ORDER BY t DESC LIMIT 50) s;
    SELECT coalesce(jsonb_agg(jsonb_build_object('t', t, 'o', o, 'h', h, 'l', l, 'c', c) ORDER BY t), '[]'::jsonb) INTO bars
    FROM (SELECT * FROM fx__bars4h(q.coin) ORDER BY t DESC LIMIT 30) s;
    coins := coins || jsonb_build_object(
      'coin', q.coin, 'mid', q.mid, 'mark', q.mark, 'funding_hourly', q.funding_rate,
      'quote_age_s', extract(epoch FROM now() - q.updated_at)::int,
      'change_pct', jsonb_build_object('1h', fx__chg(q.coin, q.mid, interval '1 hour'), '4h', fx__chg(q.coin, q.mid, interval '4 hours'),
        '24h', fx__chg(q.coin, q.mid, interval '24 hours'), '5d', fx__chg(q.coin, q.mid, interval '5 days')),
      'atr14_1h', fx__atr14(q.coin, '1h'), 'atr14_1d', fx__atr14(q.coin, '1d'),
      'sma20_4h', sma20, 'sma50_4h', sma50, 'bars_4h', bars,
      'maint_margin_rate', fx__mmr(q.coin), 'max_leverage', fx__coin_max_lev(q.coin));
  END LOOP;
  FOR b IN SELECT * FROM fx_books ORDER BY id LOOP
    eq := fx_book_equity(b.id);
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'coin', p.coin, 'side', p.side, 'opened_at', p.opened_at,
      'entry_px', p.entry_px, 'size', p.size, 'notional_usd', round(p.notional_usd, 2), 'leverage', p.leverage,
      'margin_usd', round(p.margin_usd, 2), 'risk_usd', round(p.risk_usd, 2), 'stop_px', p.stop_px, 'target_px', p.target_px,
      'liq_px', p.liq_px, 'signal_ref', p.signal_ref, 'thesis', p.thesis, 'mid', qq.mid,
      'unrealized_usd', round(greatest((CASE WHEN p.side = 'long' THEN 1 ELSE -1 END) * (qq.mid - p.entry_px) * p.size - p.funding_usd, -p.margin_usd), 4))
      ORDER BY p.opened_at), '[]'::jsonb) INTO pos
    FROM fx_positions p LEFT JOIN fx_quotes qq ON qq.coin = p.coin WHERE p.book = b.id AND p.status = 'open';
    books := books || jsonb_build_object('book', b.id, 'status', b.status, 'attempt', b.attempt,
      'equity_usd', round(eq, 4), 'equity_sek', CASE WHEN fx > 0 THEN round(eq * fx, 2) END, 'cash_usd', round(b.cash_usd, 4),
      'start_sek', b.start_sek, 'target_sek', b.target_sek,
      'progress_pct', CASE WHEN fx > 0 THEN round((eq * fx - b.start_sek) / (b.target_sek - b.start_sek) * 100, 2) END,
      'realized_today_usd', round(fx__realized_today(b.id, b.attempt), 4),
      'rules', jsonb_build_object('max_leverage', b.max_leverage, 'max_risk_pct', b.max_risk_pct, 'max_open', b.max_open,
        'daily_loss_pct', b.daily_loss_pct, 'fee_pct', b.fee_pct, 'slip_pct', b.slip_pct, 'allowed_coins', b.allowed_coins),
      'open_positions', pos);
  END LOOP;
  RETURN jsonb_build_object('as_of', now(), 'usd_sek', fx, 'coins', coins, 'books', books);
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'fx__mmr(text)', 'fx__coin_max_lev(text)', 'fx__slip(text, numeric)', 'fx_book_equity(text)', 'fx__realized_today(text, int)',
    'fx__close(uuid, numeric, text, timestamptz)',
    'fx_open(text, text, text, numeric, numeric, numeric, numeric, text, text)', 'fx_close(uuid, text)',
    'fx_amend(uuid, numeric, numeric)', 'fx_settle(uuid, numeric, timestamptz, numeric, text, timestamptz)',
    'fx_snapshot()', 'fx__bars4h(text)', 'fx__atr14(text, text)', 'fx__chg(text, numeric, interval)', 'fx_context()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- Agents page: FX section with the engine (pg_cron 'fx-tick') and Claude's trader task.
ALTER TABLE public.desk_agents DROP CONSTRAINT IF EXISTS desk_agents_section_check;
ALTER TABLE public.desk_agents ADD CONSTRAINT desk_agents_section_check CHECK (section IN ('desk', 'scout', 'reports', 'fx'));
INSERT INTO public.desk_agents (key, name, role, section, kind, cron_job, schedule, sort, description) VALUES
 ('fx_engine', 'FX Engine', 'Paper execution', 'fx', 'app', 'fx-tick', NULL, 200,
  'Every 5 minutes: FX and metals prices from Hyperliquid, price history for analysis, stops, targets, liquidations and funding on the two FX paper books.'),
 ('fx_trader', 'FX Trader', 'Claude', 'fx', 'claude', NULL, 'CRON_TZ=Europe/Stockholm 0 */2 * * 1-5', 210,
  'Weekdays every 2 h: reads the FX context and opens, moves or closes paper trades in the Sprint and Steady books.')
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, section = EXCLUDED.section, kind = EXCLUDED.kind,
  cron_job = EXCLUDED.cron_job, schedule = EXCLUDED.schedule, sort = EXCLUDED.sort, description = EXCLUDED.description;