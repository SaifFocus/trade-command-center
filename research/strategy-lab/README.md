# Strategy lab

Offline backtests for APEX setup ideas. Nothing here runs in the app.

## Data

Export from the database (as owner/admin) into `data/` next to these files (git-ignored):

| File | Contents | Query shape |
|---|---|---|
| `h1.json` | 1h candles per coin | `{coin: [[hour, o, h, l, c, v], …]}` from `hl_candles where interval='1h'` |
| `f1.json` | hourly funding per coin | `{coin: [[hour, rate], …]}` from `hl_funding` |
| `h4.json` | 4h candles + 4h funding sum | `{coin: [[hour, o, h, l, c, v, funding_sum], …]}` |
| `d1.json` | daily candles | `{coin: [[hour, o, h, l, c, v], …]}` |

`hour` = Unix seconds / 3600 of the bar open.

## Files

- `lab.py`: loader, indicators, per-coin trade simulator (market or resting-limit entries, maker/taker exits, stops checked before targets, funding hourly), metrics, and a $ portfolio replay (risk sizing, $10 minimum, leverage cap, slots, same-side cap, daily/weekly limits, kill level).
- `strats.py`: candidate setups (RSI(2), Bollinger fade, flush bounce, Donchian/volume breakout, Asia-range breakout, funding fade, EMA pullback).
- `scan.py <1h|4h>`: grid scan, each variant scored on the first 60% and last 40% of the period.
- `don.py <1h|4h>`: sensitivity analysis of the breakout family.
- `mc.py <trades.json> [setups]`: portfolio Monte Carlo over engine trades (random order among simultaneous signals).
- `lab-run.ts`: runs the production engine (`src/lib/hl/engine.ts`) on the same files. `SETUPS`, `COINS`, `MAXOPEN`, `DUMP` env vars. Run with `LAB_DATA=… npx tsx research/strategy-lab/lab-run.ts`.

## Costs used

Taker 0.045% + 0.05% slippage per side; maker 0.015% for resting limits; hourly funding.

## Results (2026-10-11 run)

- 1h, 21 coins, 210 days: RSI(2), Bollinger and flush-bounce fades won 56–63% of trades but lost money after costs; only maker entries would bring them near zero. No 1h setup passed both halves.
- 4h, 43 coins, 836 days: the volume breakout (18-bar channel, >2x volume, EMA200 side, 3 ATR stop) was positive in both halves in 49 of 64 grid variants. Adopted as `volume_breakout` with half off at +1R (~49% win rate, ~+0.13R/trade uncapped).
- The four original setups, run uncapped (every signal taken), were about −0.02R/trade on the top coins; their positive capped result depended on which coins got the 4 slots.
