# Phase 1b — Smart-Money Scout (paper only)

This build is large, so it ships in four steps. Each step is usable when it's done, and I report after each one. All lockdown rules stay in place: only the owner can read, only the server writes, every action checks for the owner, and every scheduled route needs the cron secret.

## Step 1 — Data and candidate pool
- Add tables: sm_wallets, sm_trades, sm_wallet_stats, sm_scores, sm_positions, sm_events, sm_queue and sm_jobs (for progress and the rate budget). Each table has owner-only read access and no client writes.
- One shared rate limiter for every job, including the existing desk sync. It allows at most 800 request weight per minute and tracks usage in the database, so separate requests share the same budget.
- Leaderboard pull: the parser reads the data in chunks and logs the real field names on the first run. It applies the floor filters (no profit filter, vaults excluded) and samples 300 wallets by month volume, 300 by all-time profit and 200 at random.
- Invo ingest: a pure-JS LZ4 frame decoder plus a CSV parser. The first run logs the header and ingests 60 days of files, then one new file each day. It counts each wallet's fills and works out its originator share (opens grouped by coin and side into 30-minute clusters).

## Step 2 — Deep dive and scoring
- A protected route runs every 5 minutes and works through a queue that can resume where it stopped. Each run takes a few wallets within the rate budget. Graded wallets are refreshed weekly and watchlist wallets daily.
- For each wallet: fetch the portfolio and 180 days of fills, rebuild closed trades, and compute every metric listed in the brief.
- Scoring is a pure function in `src/lib/sm/score.ts`, with tests for the bands, caps, filters and tiers. Results go into sm_scores, and the watchlist is rebuilt as the top 30 wallets.

## Step 3 — Walk-forward copy backtest
- Sync 1h candles and hourly funding for the liquid coins the candidates trade.
- A pure engine grades wallets month by month using only data from before each month. It simulates following their opens with the entry, stop, targets, exits and costs from the brief. It runs two variants (tier A, consensus) and breaks results down by source.
- Results go into backtest_runs with kind = 'copy', using the same summary format and the gate (at least 60 trades, positive expectancy in both samples, max drawdown under 20%).

## Step 4 — Live tracking, follow signals, /scout page
- A protected route runs every 5 minutes. It compares each watchlist wallet's positions with the last snapshot and writes the changes to sm_events.
- The 'smart_money_follow' setup is turned on. It creates signals under the brief's rules and records the full wallet context. A follow-exit closes our paper position at the next cycle once every source wallet has closed.
- The desk-execute job changes to run hourly at :50.
- A /scout page in the terminal style: wallet table with filters, a wallet drawer (equity curve and trades), live events, copy-backtest results and job progress.

## Run and report
Start the leaderboard pull and the Invo ingest. The queue grades roughly 300–400 wallets an hour within the budget, so I'll give an estimate for grading all ~800+ candidates. I'll run the copy backtest once enough wallets are graded, or give an ETA. Then I'll report every item you asked for.

## Technical notes
- New code goes in `src/lib/sm/*.server.ts` (fetching and database work) and pure modules (`lz4.ts`, `positions.ts`, `score.ts`, `copy-engine.ts`) with tests.
- New cron routes: `/api/cron/sm-deep-dive`, `/api/cron/sm-track`, `/api/cron/sm-daily` (leaderboard and Invo, once a day). Each one verifies the cron secret.
- The deep-dive runs keep each request short (about 25 seconds) to stay within the server's time limit.
