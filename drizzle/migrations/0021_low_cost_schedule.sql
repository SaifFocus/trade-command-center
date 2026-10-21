-- Low-cost schedule (2026-10-21). The workspace ran out of Lovable Cloud credits on 9 Oct and APEX was paused from
-- 13 to 21 Oct; background jobs are the main cost. Schedules applied on 21 Oct:
--   sm-track */5 (was every minute), sm-deep-dive */15 (was */3), desk-universe daily 03:41 (was */3),
--   sm-copy-sync hourly (was */15), sm-invo every 6 h (was hourly), live-reconcile */10 while live is off (was */2).
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'sm-track'), schedule := '2-59/5 * * * *');
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'sm-deep-dive'), schedule := '*/15 * * * *');
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'desk-universe'), schedule := '41 3 * * *');
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'sm-copy-sync'), schedule := '7 * * * *');
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'sm-invo'), schedule := '35 */6 * * *');

-- The live watchdog must run every 2 minutes whenever real money can trade. Arming (or a kill) switches it back to
-- every 2 minutes automatically; disarmed with no kill pending it runs every 10 minutes.
CREATE OR REPLACE FUNCTION public.live_reconcile_schedule() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'live-reconcile'),
    schedule := CASE WHEN NEW.live_armed OR NEW.kill_switch THEN '*/2 * * * *' ELSE '*/10 * * * *' END);
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.live_reconcile_schedule() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS live_reconcile_schedule ON public.desk_config;
CREATE TRIGGER live_reconcile_schedule AFTER INSERT OR UPDATE OF live_armed, kill_switch ON public.desk_config
  FOR EACH ROW EXECUTE FUNCTION public.live_reconcile_schedule();
SELECT cron.alter_job((SELECT jobid FROM cron.job WHERE jobname = 'live-reconcile'),
  schedule := CASE WHEN (SELECT live_armed OR kill_switch FROM public.desk_config WHERE id = 1) THEN '*/2 * * * *' ELSE '*/10 * * * *' END);
