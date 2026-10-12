-- Owner's choice (2026-10-12): more paper trades. Up to 10 open paper positions, at most 5 on one side.
-- Daily/weekly loss stops and the 15% drawdown kill stay. Live limits are unchanged.
UPDATE public.desk_config SET paper_max_open = 10, paper_max_same_side = 5 WHERE id = 1;
