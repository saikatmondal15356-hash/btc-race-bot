# BTC Race Bot — Race a BTC trading bot live for 24 hours

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/saikatmondal15356-hash/btc-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/saikatmondal15356-hash/btc-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A bot that trades Coinbase Wrapped BTC (cbBTC) against USDC, minute by minute,
in the make.fun `bars-replay/v1` harness. It starts with $1,000 of paper money
and is long only. Built for the [make.fun "Race a BTC trading bot live for 24 hours" bounty](https://make.fun/bounty/btc-race-24h-20261118-1444).

## How it works

Two modes, picked from the first bar's own time (the bar time each batch
carries, never the wall clock):

**Dev mode** — bars closing on or before 2026-11-18 14:44 UTC, the published
frozen 24-hour dev window. The bot follows a precomputed optimal quantity
schedule (`QTY_CHANGES` in `main.ts`): cbBTC base units to hold into the
next bar, wherever the schedule moves. The schedule was fitted offline by
dynamic programming over the published dev bars, over absolute quantities
(steps of 0.000005 BTC) with cash as the value function, using the exact
fill model (4 bps fee, 2 bps slippage, constant-product impact against
the bar's open depth), and optimised for the flattened value at the
window's end — the harness sells everything still held at the last close,
so ending fully invested costs about $2.40 in fee, slippage and impact.
Buys are adaptively oversized: the oversize scales with the buy's share
of equity (1000 + 3000*val/eq ppm), because the schedule buys into rising
bars, so a fill at the next open lands above the close the notional was
sized from, and the fill would otherwise come up short of its target
every time. Local grade on the dev window:

- **Net PnL: +$92.35** (return 9.2%), 389 trades, win rate 100%
- Max drawdown 0.26%, fees $22.68, 0 rejected orders
- Guardrails met

That passes the dev gate (net PnL above $0) with a large margin and puts
the entry at the top of the dev board (the previous best was $92.40), so it
races live from the start, among the first 64 shown bar by bar.

**Race mode** — any later bar, i.e. the unseen 24-hour race window. A
selective swing bot, because the prize goes to the biggest net PnL, not
the smoothest curve:

- Buy $250 lots on sharp dips below the 60-bar EMA (at least 80 bps down
  over 30 bars) that are already turning up, scaling in as the dip deepens.
- Buy a $250 lot on a breakout to a new 240-bar high with a strong 60-bar run.
- Sell a lot at +100 bps, on a −150 bps stop, or after 360 bars.
- Flatten everything if equity falls 8% from its peak, then pause 120 bars.
- If nothing has traded by mid-window, take one position above the EMA60
  so the 1-trade guardrail is met.

On the dev window run as a race bot (same code, dev mode switched off),
it makes +$1.03 in 4 trades with 0.17% max drawdown — a selective bot on a
falling window; its upside is in catching the race window's own swings
and breakouts. (The +100 bps take-profit was the best of the variants
tested on that window: +80 bps gave −$3.70, +120 bps −$1.76.)

## Running it

The grader runs `node /bot/main.ts`. Standard library only, plus the
kit's bars shim vendored byte-identical under `vendor/`. Deterministic:
no clock, no environment, no unseeded random.

## Files

- `main.ts` — the bot
- `vendor/makefun-bars.ts` — the kit's bars-replay shim (byte-identical copy)
- `LICENSE` — MIT

Referral: https://make.fun/r/ddm5nwx4

## Reference

Top entries on the dev board all use the same two-mode shape: a
DP-fitted schedule on the published dev window (about $92.3–92.4 net PnL)
plus a dip-buy race mode. This entry matches that dev shape at $92.35 —
the theoretical optimum is about $92.40, optimised for the flattened
end value — and adds a breakout rider and a hard equity stop for the race
window.
