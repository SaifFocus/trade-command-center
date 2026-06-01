ALTER TABLE public.markets REPLICA IDENTITY FULL;
ALTER TABLE public.portfolio_snapshots REPLICA IDENTITY FULL;
ALTER TABLE public.agent_logs REPLICA IDENTITY FULL;
ALTER TABLE public.milestones REPLICA IDENTITY FULL;
ALTER TABLE public.trades REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='markets') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.markets';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='portfolio_snapshots') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.portfolio_snapshots';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='agent_logs') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_logs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='milestones') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.milestones';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='trades') THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.trades';
  END IF;
END $$;