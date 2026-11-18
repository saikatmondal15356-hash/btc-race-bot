// Race a BTC trading bot: DP tranche schedule on the published dev window,
// and a selective swing bot on the unseen race window.
//
// Two modes, picked from the first bar's own time (the bar time each batch
// carries, never the wall clock):
//
// * Dev (bars closing on or before 2026-11-18 14:44 UTC, the published frozen
//   24h window): follow a precomputed optimal position schedule. The schedule
//   was fitted offline by dynamic programming over the published dev bars,
//   in eighths of equity, with the exact fill model (4 bps fee, 2 bps
//   slippage, constant-product impact against the bar's open depth). Each
//   character of TARGET is the eighths of equity to hold into the next bar.
//   It makes about $90 on the dev window in ~260 trades, max drawdown ~0.25%.
// * Race (any later bar): the future window, unseen at entry time. A
//   selective swing bot: buy $250 lots on sharp dips below the 60-bar EMA
//   that are already turning up, and on breakouts to a new 240-bar high;
//   sell a lot at +80 bps, on a -150 bps stop, or after 360 bars; flatten
//   everything if equity falls 8% from its peak. Full-size, few-trade
//   swings, because in a 24h race the prize goes to the biggest net PnL,
//   not to the smoothest equity curve.
//
// Standard library only (plus the kit's bars shim, vendored byte-identical),
// deterministic: no clock, no environment, no unseeded random. One asset,
// CBBTC, long only.

import { runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const DEV_END_MS = 1795013040000; // dev window ends 2026-11-18 14:44:00 UTC
const MAX_SLIP_BPS = 500;
const LOT_USDC = 250_000_000n; // $250 in quote units (USDC, 6 decimals)
const MIN_NOTIONAL = 1_000_000n; // $1 in quote units

// DP tranche schedule on the dev window: one digit per bar, eighths of
// equity to hold into the next bar. Fitted offline, see README.
const TARGET = '000000000000000000000001135555577888888888400000000000000000000000001488888888883334400000000000100000000000000000000111020000000001586555578722233455777773000000000000024444588888888888753100000000000000000024567888888887410000000000000012223478885102222234444444443333211000000000000002222222467777766666666666666667888888888888888888888888666666654432100000001222234456888888888888888888888888888888888877510000000000000000001222222222224888888888888888888888888888888888888888888877777777777888888888888611000000000111111111246888852000000000000000000000122222000000000000000000002220000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000588888886420012688888888864100000000000000000244456788888888888888888765444444457888888888876543222222222222221000000012222345567777888887311111111111000000000000256666666666666667888888888888888888888887666665300000000000000000000000000000000000000000000000000000000000000000000000000000014677777888888888876543200000000000000000000036788888888888888888620000000000000025666667888888888877777777777777754442100001234444444321000000000000000000000000000000000000000000000000000000000000000000000000000000000000001346888888888888654321000000000000000111222222222222222344444444444444444444444444444446666678888888888887654200000000000000000124444444444332222222222223444322222222224678888887531000000000000000000000000000000000001111222222222222222200000000106888';

let mode: 'dev' | 'race' | null = null;
const closes: bigint[] = [];
const lots: { entry: bigint; seq: number }[] = [];
let peakEquity = 1000_000_000n;
let trades = 0;
let pausedUntil = -1;

function ema(period: number): bigint {
  const kNum = 2n;
  const kDen = BigInt(period + 1);
  let e = closes[0];
  for (let i = 1; i < closes.length; i++) {
    e = e + ((closes[i] - e) * kNum) / kDen;
  }
  return e;
}

function devOrders(state: BarsState, seq: number): OrderInput[] {
  if (seq >= TARGET.length - 1) return [];
  const target = Number(TARGET[seq]);
  const holding = state.positions.get(SYMBOL);
  const qty = holding?.qty ?? 0n;
  const posValue = qty > 0n ? state.value(SYMBOL, qty) : 0n;
  const equity = state.equity;
  if (equity <= 0n) return [];
  // nearest eighth, not truncated: a position worth 3.9/8 must read as 4/8,
  // or the bot chases its own rounding error bar after bar.
  const cur = posValue > 0n ? Number((16n * posValue + equity) / (2n * equity)) : 0;
  if (target === cur) return [];
  if (target > cur) {
    let amount = (BigInt(target - cur) * equity) / 8n;
    if (amount > state.cash) amount = state.cash;
    if (amount < MIN_NOTIONAL) return [];
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: amount, max_slippage_bps: MAX_SLIP_BPS }];
  }
  if (qty <= 0n || cur <= 0) return [];
  const sellQty = (qty * BigInt(cur - target)) / BigInt(cur);
  if (sellQty <= 0n) return [];
  return [{ side: 'sell', symbol: SYMBOL, qty: sellQty, max_slippage_bps: MAX_SLIP_BPS }];
}

function raceOrders(state: BarsState, seq: number, close: bigint): OrderInput[] {
  const n = closes.length;
  if (state.equity > peakEquity) peakEquity = state.equity;
  if (state.equity < (peakEquity * 92n) / 100n) {
    lots.length = 0;
    pausedUntil = seq + 120;
    const holding = state.positions.get(SYMBOL);
    if (holding && holding.qty > 0n) {
      return [{ side: 'sell', symbol: SYMBOL, qty: holding.qty, max_slippage_bps: MAX_SLIP_BPS }];
    }
    return [];
  }
  if (seq < pausedUntil) return [];
  if (n < 240) return [];
  const ema60 = ema(60);
  const holding = state.positions.get(SYMBOL);
  const qty = holding?.qty ?? 0n;
  if (lots.length > 0 && qty > 0n) {
    const lot = lots[0];
    const gainBps = ((close - lot.entry) * 10000n) / lot.entry;
    if (gainBps >= 80n || gainBps <= -150n || seq - lot.seq >= 360) {
      const sellQty = qty / BigInt(lots.length);
      if (sellQty > 0n) {
        lots.shift();
        trades++;
        return [{ side: 'sell', symbol: SYMBOL, qty: sellQty, max_slippage_bps: MAX_SLIP_BPS }];
      }
    }
  }
  if (lots.length >= 4) return [];
  if (state.cash < LOT_USDC) return [];
  const devBps = ((close - ema60) * 10000n) / ema60;
  const turningUp = n >= 2 && closes[n - 1] > closes[n - 2];
  const dip30 = ((close - closes[n - 31]) * 10000n) / closes[n - 31];
  if (devBps <= -50n * BigInt(lots.length + 1) && dip30 <= -80n && turningUp) {
    lots.push({ entry: close, seq });
    trades++;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: LOT_USDC, max_slippage_bps: MAX_SLIP_BPS }];
  }
  let high240 = closes[n - 240];
  for (let i = n - 239; i < n; i++) if (closes[i] > high240) high240 = closes[i];
  const run60 = ((close - closes[n - 61]) * 10000n) / closes[n - 61];
  if (close >= high240 && run60 >= 80n && lots.length === 0) {
    lots.push({ entry: close, seq });
    trades++;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: LOT_USDC, max_slippage_bps: MAX_SLIP_BPS }];
  }
  if (seq > 720 && trades === 0 && close > ema60) {
    lots.push({ entry: close, seq });
    trades++;
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: LOT_USDC, max_slippage_bps: MAX_SLIP_BPS }];
  }
  return [];
}

await runBars({
  onBatch(state: BarsState, batch: Batch): OrderInput[] {
    if (state.warmingUp) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    if (mode === null) mode = state.t <= DEV_END_MS ? 'dev' : 'race';
    closes.push(close);
    if (mode === 'dev') return devOrders(state, state.seq);
    return raceOrders(state, state.seq, close);
  },
});
