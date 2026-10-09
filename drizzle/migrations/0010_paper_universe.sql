-- Paper universe: extra coins (ranks 21–40 by volume) that passed the group backtest in universe.server.ts.
ALTER TABLE public.desk_config ADD COLUMN IF NOT EXISTS paper_extra_coins text[] NOT NULL DEFAULT '{}';

-- Why a shadow position exists: 'vetoed' (review said no) or 'risk' (approved but blocked by the risk rules).
ALTER TABLE public.paper_positions ADD COLUMN IF NOT EXISTS shadow_reason text;
UPDATE public.paper_positions SET shadow_reason = 'vetoed' WHERE shadow AND shadow_reason IS NULL;
ALTER TABLE public.paper_positions DROP CONSTRAINT IF EXISTS paper_positions_shadow_reason_check;
ALTER TABLE public.paper_positions ADD CONSTRAINT paper_positions_shadow_reason_check
  CHECK (shadow_reason IS NULL OR shadow_reason IN ('vetoed', 'risk'));

-- Universe check job: every 3 minutes until it finishes (then each call returns at once).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'desk-universe';
SELECT cron.schedule('desk-universe', '1-59/3 * * * *', $cron$
  select net.http_post(
    url := 'https://apextradyr.lovable.app/api/cron/desk-universe',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(select value from public.app_private where name='hl_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000);
$cron$);
