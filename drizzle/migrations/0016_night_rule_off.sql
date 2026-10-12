-- Owner's choice (2026-10-12): entries around the clock, so the night rule is off for paper and live.
UPDATE public.desk_config SET night_rule = false WHERE id = 1;
-- Owner's sizing rule lives in code (SIZE_UP in src/lib/hl/risk.ts, used by paper and live sizing): a trade the reviewer
-- rates at 70%+ to reach T1 is sized up just enough for a T1/T2 split above the $10 minimum, never above $40.
