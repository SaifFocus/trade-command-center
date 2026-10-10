-- Content Rewards (Whop clipping) control room. Owner-only SELECT, no client writes; external agents write via
-- service_role-only cr_* functions, the owner UI writes via owner-checked server functions.
CREATE TABLE IF NOT EXISTS public.cr_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  whop_url text NOT NULL UNIQUE,
  brand text, title text,
  category text NOT NULL DEFAULT 'clipping' CHECK (category IN ('clipping','ugc','other')),
  rate_per_1k_usd numeric, budget_total_usd numeric, budget_remaining_usd numeric,
  min_payout_usd numeric, max_payout_usd numeric, flat_fee_usd numeric,
  platforms text[] NOT NULL DEFAULT '{}',
  min_length_s int, max_length_s int,
  required_hashtags text[] NOT NULL DEFAULT '{}',
  required_credit text,
  disclosure_required boolean NOT NULL DEFAULT false,
  prohibited text,
  source_assets text[] NOT NULL DEFAULT '{}',
  deadline timestamptz,
  score int CHECK (score BETWEEN 1 AND 5),
  red_flags text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'watching' CHECK (status IN ('watching','active','paused','closed','rejected')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cr_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('tiktok','instagram','youtube','x','other')),
  handle text NOT NULL,
  linked_in_whop boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'warming' CHECK (status IN ('active','warming','restricted','banned')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, handle)
);

CREATE TABLE IF NOT EXISTS public.cr_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.cr_campaigns(id) ON DELETE CASCADE,
  source_url text, source_start_s numeric, source_end_s numeric,
  hook text, value_layer text, variant text, file_ref text,
  stage text NOT NULL DEFAULT 'found' CHECK (stage IN ('found','cut','qa','awaiting_approval','approved','posted','submitted','tracking','paid','denied')),
  qa_notes text,
  created_by_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cr_clips_stage_idx ON public.cr_clips (stage);

CREATE TABLE IF NOT EXISTS public.cr_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL REFERENCES public.cr_clips(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.cr_accounts(id) ON DELETE SET NULL,
  platform text,
  post_url text NOT NULL UNIQUE,
  posted_at timestamptz,
  caption text,
  views_24h bigint, views_72h bigint, views_7d bigint, views_current bigint NOT NULL DEFAULT 0,
  whop_submission_id text,
  submission_status text NOT NULL DEFAULT 'pending' CHECK (submission_status IN ('pending','submitted','approved','denied')),
  denial_reason text,
  est_earnings_usd numeric NOT NULL DEFAULT 0,
  paid_usd numeric NOT NULL DEFAULT 0,
  earning_window_ends_at timestamptz,
  payout_eta timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cr_agents (
  key text PRIMARY KEY,
  name text NOT NULL, role text, description text,
  autonomy text NOT NULL DEFAULT 'assisted' CHECK (autonomy IN ('manual','assisted','auto')),
  enabled boolean NOT NULL DEFAULT true,
  schedule_text text,
  sort int NOT NULL DEFAULT 0,
  last_run_at timestamptz, next_run_at timestamptz, last_status text
);

CREATE TABLE IF NOT EXISTS public.cr_agent_runs (
  id bigserial PRIMARY KEY,
  agent_key text NOT NULL REFERENCES public.cr_agents(key) ON DELETE CASCADE,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','warning','error')),
  summary text,
  items_processed int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS cr_agent_runs_started_idx ON public.cr_agent_runs (started_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['cr_campaigns','cr_accounts','cr_clips','cr_posts','cr_agents','cr_agent_runs'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS owner_select ON public.%I', t);
    EXECUTE format('CREATE POLICY owner_select ON public.%I FOR SELECT TO authenticated USING (public.is_owner())', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.%I FROM authenticated', t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE public.cr_agent_runs_id_seq TO service_role;

-- Agent configuration (not sample data).
INSERT INTO public.cr_agents (key, name, role, description, autonomy, sort) VALUES
 ('campaign_scout','Campaign Scout','Discovery','Finds new Content Rewards campaigns and scores rate × remaining budget × fit','assisted',1),
 ('brief_parser','Brief Parser','Spec','Turns campaign rules into a structured spec and flags red flags','assisted',2),
 ('source_collector','Source Collector','Sourcing','Pulls only campaign-authorised source videos/files','assisted',3),
 ('clip_finder','Clip Finder','Selection','Transcribes and picks the strongest 20–45 s moments with honest hooks','assisted',4),
 ('editor','Editor','Production','Renders 9:16 variants with captions and hook text','assisted',5),
 ('qa_gatekeeper','QA Gatekeeper','Quality','Checks each clip against the spec (length, hashtags, credit, disclosure, originality) before it reaches approval','assisted',6),
 ('publisher','Publisher','Distribution','Schedules approved clips to linked accounts via Postiz','manual',7),
 ('submitter','Submitter','Submission','Submits live post URLs to Whop','manual',8),
 ('analyst','Analyst','Analytics','Tracks views, submission status and earnings, flags budget drain, writes a weekly report','assisted',9)
ON CONFLICT (key) DO NOTHING;

-- External agent write path (service_role/postgres only).
CREATE OR REPLACE FUNCTION public.cr_upsert_campaign(p jsonb) RETURNS public.cr_campaigns
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.cr_campaigns;
BEGIN
  IF coalesce(p->>'whop_url','') = '' THEN RAISE EXCEPTION 'cr_upsert_campaign: whop_url required'; END IF;
  INSERT INTO public.cr_campaigns AS c (whop_url) VALUES (p->>'whop_url') ON CONFLICT (whop_url) DO NOTHING;
  UPDATE public.cr_campaigns c SET
    brand = CASE WHEN p ? 'brand' THEN p->>'brand' ELSE c.brand END,
    title = CASE WHEN p ? 'title' THEN p->>'title' ELSE c.title END,
    category = CASE WHEN p ? 'category' THEN p->>'category' ELSE c.category END,
    rate_per_1k_usd = CASE WHEN p ? 'rate_per_1k_usd' THEN (p->>'rate_per_1k_usd')::numeric ELSE c.rate_per_1k_usd END,
    budget_total_usd = CASE WHEN p ? 'budget_total_usd' THEN (p->>'budget_total_usd')::numeric ELSE c.budget_total_usd END,
    budget_remaining_usd = CASE WHEN p ? 'budget_remaining_usd' THEN (p->>'budget_remaining_usd')::numeric ELSE c.budget_remaining_usd END,
    min_payout_usd = CASE WHEN p ? 'min_payout_usd' THEN (p->>'min_payout_usd')::numeric ELSE c.min_payout_usd END,
    max_payout_usd = CASE WHEN p ? 'max_payout_usd' THEN (p->>'max_payout_usd')::numeric ELSE c.max_payout_usd END,
    flat_fee_usd = CASE WHEN p ? 'flat_fee_usd' THEN (p->>'flat_fee_usd')::numeric ELSE c.flat_fee_usd END,
    platforms = CASE WHEN p ? 'platforms' THEN ARRAY(SELECT jsonb_array_elements_text(p->'platforms')) ELSE c.platforms END,
    min_length_s = CASE WHEN p ? 'min_length_s' THEN (p->>'min_length_s')::int ELSE c.min_length_s END,
    max_length_s = CASE WHEN p ? 'max_length_s' THEN (p->>'max_length_s')::int ELSE c.max_length_s END,
    required_hashtags = CASE WHEN p ? 'required_hashtags' THEN ARRAY(SELECT jsonb_array_elements_text(p->'required_hashtags')) ELSE c.required_hashtags END,
    required_credit = CASE WHEN p ? 'required_credit' THEN p->>'required_credit' ELSE c.required_credit END,
    disclosure_required = CASE WHEN p ? 'disclosure_required' THEN (p->>'disclosure_required')::boolean ELSE c.disclosure_required END,
    prohibited = CASE WHEN p ? 'prohibited' THEN p->>'prohibited' ELSE c.prohibited END,
    source_assets = CASE WHEN p ? 'source_assets' THEN ARRAY(SELECT jsonb_array_elements_text(p->'source_assets')) ELSE c.source_assets END,
    deadline = CASE WHEN p ? 'deadline' THEN (p->>'deadline')::timestamptz ELSE c.deadline END,
    score = CASE WHEN p ? 'score' THEN (p->>'score')::int ELSE c.score END,
    red_flags = CASE WHEN p ? 'red_flags' THEN ARRAY(SELECT jsonb_array_elements_text(p->'red_flags')) ELSE c.red_flags END,
    status = CASE WHEN p ? 'status' THEN p->>'status' ELSE c.status END,
    notes = CASE WHEN p ? 'notes' THEN p->>'notes' ELSE c.notes END,
    updated_at = now()
  WHERE c.whop_url = p->>'whop_url' RETURNING * INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.cr_add_clip(p_campaign_id uuid, p jsonb) RETURNS public.cr_clips
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.cr_clips;
BEGIN
  INSERT INTO public.cr_clips (campaign_id, source_url, source_start_s, source_end_s, hook, value_layer, variant, file_ref, stage, qa_notes, created_by_agent)
  VALUES (p_campaign_id, p->>'source_url', (p->>'source_start_s')::numeric, (p->>'source_end_s')::numeric, p->>'hook', p->>'value_layer',
          p->>'variant', p->>'file_ref', coalesce(p->>'stage','found'), p->>'qa_notes', p->>'created_by_agent')
  RETURNING * INTO r;
  RETURN r;
END $$;

-- Agents may not approve: 'approved' is owner-only (UI). Agents can move clips to awaiting_approval or past approval.
CREATE OR REPLACE FUNCTION public.cr_set_clip_stage(p_clip_id uuid, p_stage text, p_notes text) RETURNS public.cr_clips
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.cr_clips; cur text;
BEGIN
  SELECT stage INTO cur FROM public.cr_clips WHERE id = p_clip_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cr_set_clip_stage: clip % not found', p_clip_id; END IF;
  IF p_stage = 'approved' THEN RAISE EXCEPTION 'cr_set_clip_stage: only the owner can approve clips'; END IF;
  IF p_stage IN ('posted','submitted','tracking','paid') AND cur NOT IN ('approved','posted','submitted','tracking','paid') THEN
    RAISE EXCEPTION 'cr_set_clip_stage: clip % must be approved before %', p_clip_id, p_stage;
  END IF;
  UPDATE public.cr_clips SET stage = p_stage, qa_notes = coalesce(p_notes, qa_notes), updated_at = now()
  WHERE id = p_clip_id RETURNING * INTO r;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.cr_record_post(p_clip_id uuid, p jsonb) RETURNS public.cr_posts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.cr_posts; cur text;
BEGIN
  SELECT stage INTO cur FROM public.cr_clips WHERE id = p_clip_id;
  IF cur IS NULL OR cur NOT IN ('approved','posted','submitted','tracking','paid') THEN
    RAISE EXCEPTION 'cr_record_post: clip % is not approved', p_clip_id;
  END IF;
  INSERT INTO public.cr_posts (clip_id, account_id, platform, post_url, posted_at, caption, whop_submission_id, submission_status, earning_window_ends_at, payout_eta)
  VALUES (p_clip_id, (p->>'account_id')::uuid, p->>'platform', p->>'post_url', coalesce((p->>'posted_at')::timestamptz, now()), p->>'caption',
          p->>'whop_submission_id', coalesce(p->>'submission_status','pending'), (p->>'earning_window_ends_at')::timestamptz, (p->>'payout_eta')::timestamptz)
  ON CONFLICT (post_url) DO UPDATE SET
    whop_submission_id = coalesce(EXCLUDED.whop_submission_id, cr_posts.whop_submission_id),
    submission_status = EXCLUDED.submission_status,
    earning_window_ends_at = coalesce(EXCLUDED.earning_window_ends_at, cr_posts.earning_window_ends_at),
    payout_eta = coalesce(EXCLUDED.payout_eta, cr_posts.payout_eta),
    updated_at = now()
  RETURNING * INTO r;
  IF cur = 'approved' THEN UPDATE public.cr_clips SET stage = 'posted', updated_at = now() WHERE id = p_clip_id; END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.cr_update_post_metrics(p_post_id uuid, p jsonb) RETURNS public.cr_posts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.cr_posts;
BEGIN
  UPDATE public.cr_posts c SET
    views_24h = coalesce((p->>'views_24h')::bigint, c.views_24h),
    views_72h = coalesce((p->>'views_72h')::bigint, c.views_72h),
    views_7d = coalesce((p->>'views_7d')::bigint, c.views_7d),
    views_current = coalesce((p->>'views_current')::bigint, c.views_current),
    submission_status = coalesce(p->>'submission_status', c.submission_status),
    whop_submission_id = coalesce(p->>'whop_submission_id', c.whop_submission_id),
    denial_reason = coalesce(p->>'denial_reason', c.denial_reason),
    est_earnings_usd = coalesce((p->>'est_earnings_usd')::numeric, c.est_earnings_usd),
    paid_usd = coalesce((p->>'paid_usd')::numeric, c.paid_usd),
    earning_window_ends_at = coalesce((p->>'earning_window_ends_at')::timestamptz, c.earning_window_ends_at),
    payout_eta = coalesce((p->>'payout_eta')::timestamptz, c.payout_eta),
    updated_at = now()
  WHERE c.id = p_post_id RETURNING * INTO r;
  IF NOT FOUND THEN RAISE EXCEPTION 'cr_update_post_metrics: post % not found', p_post_id; END IF;
  RETURN r;
END $$;

CREATE OR REPLACE FUNCTION public.cr_log_agent_run(p_agent_key text, p_status text, p_summary text, p_items int, p_started_at timestamptz, p_next_run_at timestamptz)
RETURNS public.cr_agent_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.cr_agent_runs;
BEGIN
  INSERT INTO public.cr_agent_runs (agent_key, started_at, finished_at, status, summary, items_processed)
  VALUES (p_agent_key, coalesce(p_started_at, now()), now(), coalesce(p_status,'ok'), p_summary, coalesce(p_items,0))
  RETURNING * INTO r;
  UPDATE public.cr_agents SET last_run_at = now(), last_status = coalesce(p_status,'ok'),
    next_run_at = coalesce(p_next_run_at, next_run_at) WHERE key = p_agent_key;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION public.cr_upsert_campaign(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cr_add_clip(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cr_set_clip_stage(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cr_record_post(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cr_update_post_metrics(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cr_log_agent_run(text, text, text, int, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cr_upsert_campaign(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cr_add_clip(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cr_set_clip_stage(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cr_record_post(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cr_update_post_metrics(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.cr_log_agent_run(text, text, text, int, timestamptz, timestamptz) TO service_role;
