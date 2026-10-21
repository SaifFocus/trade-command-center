# Scoped project rules

- Content Rewards (Whop clipping): `cr_*` tables with owner-only SELECT and no client writes. External agents write only through service_role-only SQL functions (`cr_upsert_campaign`, `cr_add_clip`, `cr_set_clip_stage`, `cr_record_post`, `cr_update_post_metrics`, `cr_log_agent_run`); `cr_set_clip_stage` refuses 'approved' and posting needs an approved clip. The owner approves and edits through owner-checked server functions. Why: same pattern as `submit_review()`, and no clip goes live without the owner's approval.
