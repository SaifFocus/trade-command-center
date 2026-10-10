# Roadmap — Phase 1b Smart-Money Scout

- [x] Tables, owner-only access, shared 800/min rate budget
- [x] Leaderboard pull + Invo ingest (LZ4 decoder, originator share)
- [x] Deep dive queue, metrics, score/caps/filters/tiers (tested), watchlist
- [x] Live tracking, follow signals, follow-exits (code)
- [ ] Run the initial leaderboard pull + Invo ingest, let the queue grade wallets
- [ ] Schedule cron jobs (sm-daily, sm-deep-dive, sm-track) and desk-execute hourly at :50
- [ ] Walk-forward copy backtest (1h candles, variants, gate)
- [ ] /scout page + header link

# Roadmap — Content Rewards
- [x] Database: cr_* tables, owner-only read, agent write functions, nine agents seeded
- [ ] Sidebar navigation (groups, badges, Ctrl/Cmd+K, mobile drawer) + slim header; remove per-page nav links
- [ ] Owner server functions (campaigns, clip approve/reject, accounts, agent toggles)
- [ ] Pages: Overview, Campaigns, Pipeline, Approvals, Agents, Earnings, Accounts (empty states, USD)
