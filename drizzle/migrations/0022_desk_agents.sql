-- Trading agents page (2026-10-22): every agent that runs APEX trading, and a log of their runs, shown on /agents.
-- App agents are the pg_cron jobs (their live schedule is read from cron.job, so live-reconcile's 2/10-minute switch
-- shows up as it happens); each cron route logs its run through desk_log_agent_run (recordRun in src/lib/agents).
-- Claude agents are the owner's Claude scheduled tasks; they call desk_log_agent_run as their last step.
-- The Invo bridge on the owner's PC already logs every round in invo_bridge_runs, which desk_agent_status() reads.

CREATE TABLE IF NOT EXISTS public.desk_agents (
  key text PRIMARY KEY,
  name text NOT NULL,
  role text,
  section text NOT NULL CHECK (section IN ('desk', 'scout', 'reports')),
  kind text NOT NULL CHECK (kind IN ('app', 'claude', 'pc')),
  description text,
  cron_job text,      -- pg_cron job name (app agents)
  schedule text,      -- cron expression for Claude agents, e.g. 'CRON_TZ=Europe/Stockholm 45 8 * * *'
  sort int NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  last_status text,
  last_summary text
);

CREATE TABLE IF NOT EXISTS public.desk_agent_runs (
  id bigserial PRIMARY KEY,
  agent_key text NOT NULL REFERENCES public.desk_agents(key) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'warning', 'error')),
  items int NOT NULL DEFAULT 0,
  summary text
);
CREATE INDEX IF NOT EXISTS desk_agent_runs_started_idx ON public.desk_agent_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS desk_agent_runs_agent_idx ON public.desk_agent_runs (agent_key, started_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['desk_agents', 'desk_agent_runs'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS owner_select ON public.%I', t);
    EXECUTE format('CREATE POLICY owner_select ON public.%I FOR SELECT TO authenticated USING (public.is_owner())', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
  END LOOP;
END $$;
GRANT USAGE, SELECT ON SEQUENCE public.desk_agent_runs_id_seq TO service_role;

-- One run of an agent. Called by the cron routes (service role) and by the Claude scheduled tasks. Keeps 14 days.
CREATE OR REPLACE FUNCTION public.desk_log_agent_run(p_agent_key text, p_status text, p_summary text, p_items int,
  p_started_at timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  st text := CASE WHEN p_status IN ('ok', 'warning', 'error') THEN p_status ELSE 'warning' END;
  started timestamptz := least(coalesce(p_started_at, now()), now());
BEGIN
  IF NOT EXISTS (SELECT 1 FROM desk_agents WHERE key = p_agent_key) THEN
    RAISE EXCEPTION 'unknown agent %', p_agent_key;
  END IF;
  INSERT INTO desk_agent_runs (agent_key, started_at, finished_at, status, items, summary)
  VALUES (p_agent_key, started, now(), st, greatest(coalesce(p_items, 0), 0), left(p_summary, 500));
  UPDATE desk_agents SET last_run_at = started, last_status = st, last_summary = left(p_summary, 500) WHERE key = p_agent_key;
  IF random() < 0.01 THEN DELETE FROM desk_agent_runs WHERE started_at < now() - interval '14 days'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.desk_log_agent_run(text, text, text, int, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.desk_log_agent_run(text, text, text, int, timestamptz) TO service_role;

-- Everything the Agents page needs about each agent, in one call: registry, live schedule, last run and 24-hour counts.
-- Owner only (returns nothing to anyone else); it reads cron.job, which clients cannot see.
CREATE OR REPLACE FUNCTION public.desk_agent_status()
RETURNS TABLE(key text, name text, role text, section text, kind text, description text, sort int, schedule text,
  schedule_active boolean, last_run_at timestamptz, last_status text, last_summary text, runs_24h int, problems_24h int,
  items_24h int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT (public.is_owner() OR coalesce(auth.role(), '') = 'service_role' OR session_user = 'postgres') THEN RETURN; END IF;
  RETURN QUERY
  WITH s AS (
    SELECT r.agent_key, count(*)::int AS n, (count(*) FILTER (WHERE r.status <> 'ok'))::int AS p, coalesce(sum(r.items), 0)::int AS i
    FROM desk_agent_runs r WHERE r.started_at > now() - interval '24 hours' GROUP BY r.agent_key
  ), br AS (
    SELECT b.*, (b.logged_out OR (jsonb_typeof(b.problems) = 'array' AND jsonb_array_length(b.problems) > 0)) AS bad
    FROM invo_bridge_runs b
  ), b24 AS (
    SELECT count(*)::int AS n, (count(*) FILTER (WHERE bad))::int AS p, coalesce(sum(events), 0)::int AS i
    FROM br WHERE at > now() - interval '24 hours'
  ), bl AS (
    SELECT * FROM br ORDER BY at DESC LIMIT 1
  )
  SELECT a.key, a.name, a.role, a.section, a.kind, a.description, a.sort,
    coalesce(j.schedule::text, a.schedule),
    coalesce(j.active, true),
    CASE WHEN a.kind = 'pc' THEN (SELECT bl.at FROM bl) ELSE a.last_run_at END,
    CASE WHEN a.kind = 'pc' THEN (SELECT CASE WHEN bl.bad THEN 'warning' ELSE 'ok' END FROM bl) ELSE a.last_status END,
    CASE WHEN a.kind = 'pc' THEN (SELECT CASE WHEN bl.logged_out THEN 'Logged out of Invo: run login.cmd and sign in again'
      ELSE format('Read %s of %s portfolios · %s open positions%s', bl.parsed, bl.visited, bl.positions,
        CASE WHEN bl.events > 0 THEN format(' · %s change(s)', bl.events) ELSE '' END) END FROM bl)
      ELSE a.last_summary END,
    CASE WHEN a.kind = 'pc' THEN (SELECT b24.n FROM b24) ELSE coalesce(s.n, 0) END,
    CASE WHEN a.kind = 'pc' THEN (SELECT b24.p FROM b24) ELSE coalesce(s.p, 0) END,
    CASE WHEN a.kind = 'pc' THEN (SELECT b24.i FROM b24) ELSE coalesce(s.i, 0) END
  FROM desk_agents a
  LEFT JOIN cron.job j ON j.jobname = a.cron_job
  LEFT JOIN s ON s.agent_key = a.key
  ORDER BY a.sort;
END $$;
REVOKE ALL ON FUNCTION public.desk_agent_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.desk_agent_status() TO authenticated, service_role;

-- The agent team (configuration, not sample data).
INSERT INTO public.desk_agents (key, name, role, section, kind, cron_job, schedule, sort, description) VALUES
 ('signal_scanner', 'Signal Scanner', 'Strategy', 'desk', 'app', 'desk-cycle', NULL, 10,
  'Syncs Hyperliquid prices, manages open paper trades (stops, targets, time exits) and scans every coin for new setup signals.'),
 ('signal_reviewer', 'Signal Reviewer', 'Head trader', 'desk', 'claude', NULL, '25 * * * *', 20,
  'Researches each new signal (news, token unlocks, macro, social, funding), writes the case against it, then approves or vetoes with a confidence score.'),
 ('executor', 'Executor', 'Execution', 'desk', 'app', 'desk-execute', NULL, 30,
  'Opens approved signals as paper trades within the risk rules. Vetoed and risk-blocked signals become shadow trades, so every decision gets an outcome.'),
 ('live_watchdog', 'Live Watchdog', 'Safety', 'desk', 'app', 'live-reconcile', NULL, 40,
  'Checks real-money positions, fills, stops and the kill switch. Idle while live trading is off; runs every 2 minutes once it is armed.'),
 ('universe_builder', 'Universe Builder', 'Research', 'desk', 'app', 'desk-universe', NULL, 50,
  'Backtests the coins ranked 21–40 by volume as a group and adds the ones that pass to the paper desk.'),
 ('leaderboard_scout', 'Leaderboard Scout', 'Discovery', 'scout', 'app', 'sm-daily', NULL, 60,
  'Pulls the Hyperliquid leaderboard once a day and adds promising traders to the candidate pool.'),
 ('invo_fills', 'Invo Fills Reader', 'Discovery', 'scout', 'app', 'sm-invo', NULL, 70,
  'Reads the public files of trades placed through Invo on Hyperliquid and finds active Invo traders to grade.'),
 ('wallet_grader', 'Wallet Grader', 'Grading', 'scout', 'app', 'sm-deep-dive', NULL, 80,
  'Grades candidate wallets on their full trade history and keeps the watchlist of traders worth following.'),
 ('wallet_tracker', 'Wallet Tracker', 'Following', 'scout', 'app', 'sm-track', NULL, 90,
  'Watches the positions of every followed trader, turns new opens into follow signals, closes follow trades when the trader exits and runs the $100 Mimic copies.'),
 ('invo_bridge', 'Invo Bridge', 'Your PC', 'scout', 'pc', NULL, NULL, 100,
  'Runs on your computer: opens each followed Invo portfolio in a hidden Edge window about every 3 minutes and sends what it sees to APEX. Works only while the PC is on and awake.'),
 ('copy_sync', 'Copy Data Sync', 'Research', 'scout', 'app', 'sm-copy-sync', NULL, 110,
  'Keeps hourly price history fresh for the coins the graded traders trade, for the copy backtest.'),
 ('copy_backtest', 'Copy Backtest', 'Research', 'scout', 'app', 'sm-copy-run', NULL, 120,
  'Replays copying the graded traders over past months and checks whether copying them passes the copy gate.'),
 ('invo_rescout', 'Invo Re-scout', 'Curator', 'scout', 'claude', NULL, 'CRON_TZ=Europe/Stockholm 29 18 * * 0', 130,
  'Weekly: drops scouted Invo traders whose copies lose money or who went quiet, and adds strong traders from the Invo leaderboard (at most 30, paper only).'),
 ('daily_brief', 'Daily Brief', 'Reporter', 'reports', 'claude', NULL, 'CRON_TZ=Europe/Stockholm 45 8 * * *', 140,
  'Every morning: equity, open and closed trades, signals and anything that needs your attention.'),
 ('weekly_review', 'Weekly Review', 'Analyst', 'reports', 'claude', NULL, 'CRON_TZ=Europe/Stockholm 45 18 * * 0', 150,
  'Sundays: results by setup and by followed trader, whether vetoes and risk rules help, confidence calibration and what to switch off.')
ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role, section = EXCLUDED.section, kind = EXCLUDED.kind,
  cron_job = EXCLUDED.cron_job, schedule = EXCLUDED.schedule, sort = EXCLUDED.sort, description = EXCLUDED.description;

-- First entries, so the page is not empty before each agent's next run: the latest start of each cron job (pg_cron
-- records only that the job was started) and the last runs of the Claude scheduled tasks from their history.
INSERT INTO public.desk_agent_runs (agent_key, started_at, finished_at, status, items, summary)
SELECT a.key, d.start_time, d.end_time, 'ok', 0, 'Started by the scheduler (detailed results are logged from 22 Oct 2026)'
FROM public.desk_agents a
JOIN cron.job j ON j.jobname = a.cron_job
JOIN LATERAL (SELECT start_time, end_time FROM cron.job_run_details x WHERE x.jobid = j.jobid AND x.status = 'succeeded'
  ORDER BY start_time DESC LIMIT 1) d ON true
WHERE NOT EXISTS (SELECT 1 FROM public.desk_agent_runs r WHERE r.agent_key = a.key);

INSERT INTO public.desk_agent_runs (agent_key, started_at, finished_at, status, items, summary)
SELECT v.key, v.started::timestamptz, v.finished::timestamptz, 'ok', 0, 'Run finished (from the scheduled-task history)'
FROM (VALUES
  ('signal_reviewer', '2026-10-22 07:25:41+00', '2026-10-22 07:26:04+00'),
  ('daily_brief', '2026-10-22 06:46:02+00', '2026-10-22 06:46:35+00'),
  ('weekly_review', '2026-10-18 16:45:28+00', '2026-10-18 16:58:08+00'),
  ('invo_rescout', '2026-10-18 16:29:34+00', '2026-10-18 16:32:21+00')
) AS v(key, started, finished)
WHERE NOT EXISTS (SELECT 1 FROM public.desk_agent_runs r WHERE r.agent_key = v.key);

UPDATE public.desk_agents a SET last_run_at = r.started_at, last_status = r.status, last_summary = r.summary
FROM (SELECT DISTINCT ON (agent_key) * FROM public.desk_agent_runs ORDER BY agent_key, started_at DESC) r
WHERE r.agent_key = a.key AND a.last_run_at IS NULL;
