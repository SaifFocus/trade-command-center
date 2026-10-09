# AGENTS.md

- Hyperliquid market data is fetched only from the public info API in `src/lib/hl/*.server.ts` and written with the service-role client. Why: no keys/wallets, writes only from server code.
- Full sync runs one coin per server-function call (UI loops); the cron route `/api/cron/hl-sync` does incremental sync and self-throttles (skips if synced < 30 min ago). Why: worker request time limits.
- Backtest engine `src/lib/hl/engine.ts` is pure and deterministic; data is loaded per coin via the `hl_backtest_data` RPC (funding pre-bucketed to 4h). Why: avoids row-limit pagination and keeps the engine testable.
- Single-owner app: `public.app_owner` + `public.is_owner()`; every table has only an owner SELECT policy, clients have no write grants, and every server function uses `requireSupabaseAuth` + `assertOwner` before service-role work. Why: nobody but the owner may read, write or trigger anything.
- All pages live under `src/routes/_authenticated/` (signed-in gate + owner gate); only `/login` is outside. Why: no public surface.
- The cron route requires `x-cron-secret`, verified via service-role-only `verify_cron_secret()` against `public.app_private`; pg_cron reads the same row. Why: token never leaves the server/DB.
- A trigger on `auth.users` rejects sign-ups once an owner exists. Why: auth-level sign-up block.
