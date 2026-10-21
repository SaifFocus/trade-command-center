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
- [x] Overview/Earnings: pipeline KPIs, observed versus unavailable verified views, earning deadlines, USD estimates; 35 tests, owner totals/filter reload, mobile, private access and empty states verified; temporary data removed
- [x] Agents enable/autonomy controls, latest summaries and filtered run history; Accounts add/edit, status, Whop link declaration and empty states; owner saves/reload and mobile verified; temporary data removed
- [x] Clip Pipeline and Approvals: shared spec review, stage cards, owner decisions with notes; approved/denied readback and mobile review verified; temporary data removed
- [x] Campaigns sorting/filtering, details, budget alerts and owner add/edit/status actions; owner saves verified and temporary data removed
- [x] Database: cr_* tables, owner-only read, agent write functions, nine agents seeded
- [x] Sidebar navigation (groups, badges, Ctrl/Cmd+K, mobile drawer) + slim header; trading content preserved
- [x] Owner server functions (campaigns, clip approve/reject, accounts, agent toggles)
- [x] Pages: Overview, Campaigns, Pipeline, Approvals, Agents, Earnings, Accounts (empty states, USD)
