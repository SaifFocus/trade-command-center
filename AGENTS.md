# AGENTS.md

- Hyperliquid market data is fetched only from the public info API in `src/lib/hl/*.server.ts` and written with the service-role client; tables are read-only to anon/authenticated. Why: no keys/wallets, writes only from server code.
- Full sync runs one coin per server-function call (UI loops); the cron route `/api/public/hl-sync` does incremental sync and self-throttles (skips if synced < 30 min ago). Why: worker request time limits and the route is public.
- Backtest engine `src/lib/hl/engine.ts` is pure and deterministic; data is loaded per coin via the `hl_backtest_data` RPC (funding pre-bucketed to 4h). Why: avoids row-limit pagination and keeps the engine testable.
