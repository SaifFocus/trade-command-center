# Scoped project rules

- agent_logs.level only allows INFO/SIGNAL/WARNING/ERROR; desk logs are mapped to those. Why: there's a check constraint on the existing table.
- Live only trades signals the paper desk just filled (`runExecute` → `executeLive`). `desk_config.live_armed` is the switch; `mode` is display ('paper' or 'live'), and paper keeps trading in both. Why: paper stays the comparison.
