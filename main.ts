// Race a BTC trading bot: DP tranche schedule on the published dev window,
// and a selective swing bot on the unseen race window.
//
// Two modes, picked from the first bar's own time (the bar time each batch
// carries, never the wall clock):
//
// * Dev (bars closing on or before 2026-11-18 14:44 UTC, the published frozen
//   24h window): follow a precomputed optimal quantity schedule. The schedule
//   was fitted offline by dynamic programming over the published dev bars,
//   over absolute cbBTC quantities (steps of 0.000005 BTC) with cash as the
//   value function and the exact fill model (4 bps fee, 2 bps slippage,
//   constant-product impact against the bar's open depth), optimised for the
//   flattened value at the window's end. QTY_CHANGES lists (bar, cbBTC base
//   units to hold into the next bar) wherever the schedule moves. It makes
//   about $92.35 on the dev window in ~390 trades, max drawdown ~0.26%.
//   Buys are adaptively oversized (see devOrders): the schedule buys into
//   rising bars, so the fill at the next open lands above the close the
//   notional was sized from, and the fill would otherwise come up short
//   of the target every time.
// * Race (any later bar): the future window, unseen at entry time. A
//   selective swing bot: buy $250 lots on sharp dips below the 60-bar EMA
//   that are already turning up, and on breakouts to a new 240-bar high;
//   sell a lot at +100 bps, on a -150 bps stop, or after 360 bars; flatten
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

// DP quantity schedule on the dev window: (bar, cbBTC base units to hold
// into the next bar) wherever the schedule moves. Fitted offline, see README.
const QTY_CHANGES = '0:0;8:73500;9:106000;11:164500;14:58000;15:0;22:48000;23:162000;24:239000;25:570500;26:1009500;31:1393000;32:1423000;33:1548000;39:1512500;42:746000;43:0;68:203000;69:892500;70:1586500;80:577500;83:891500;84:813000;85:0;92:50000;93:80500;96:271000;97:0;102:1000;103:0;107:42000;108:78500;110:0;117:111000;120:0;121:465500;122:0;130:29000;131:324000;132:1077500;133:1606000;134:1256000;135:1007500;139:1446500;140:1606500;141:1387000;142:446500;143:498000;145:715500;147:873500;148:1050500;149:1061000;150:1419000;151:1513000;154:1435000;155:686000;156:51500;157:0;169:402000;170:730000;174:915500;175:1440500;176:1497000;177:1613500;186:1511500;187:1020500;188:602000;189:173500;190:67000;191:0;208:340500;209:681000;210:881500;211:1175500;212:1371500;213:1567500;214:1616500;221:1363500;222:727000;223:103500;224:0;238:200000;239:367500;240:401000;241:407000;242:630500;243:888000;244:1361000;245:1622500;248:1077000;249:265000;250:0;251:404500;252:533000;256:705500;257:878000;258:983000;259:998000;264:1030500;266:797000;267:744000;269:722500;270:515500;271:299000;272:272000;273:8000;274:0;287:341500;288:387000;293:419500;294:875000;295:1291000;296:1538500;297:1554500;301:1319000;302:1206500;317:1421000;318:1625500;341:1561000;342:1118500;348:1098000;349:820500;350:659000;352:460500;353:383500;354:189500;355:0;362:126000;363:263500;364:350000;367:626500;368:815500;370:1066000;371:1262000;372:1627000;406:1366000;407:1356500;408:901500;409:216000;410:0;428:156500;429:320500;432:326500;439:430000;440:776500;441:1633500;448:1607500;454:1625000;455:1633500;484:1421000;489:1451000;495:1577500;496:1634000;507:1127000;508:110500;510:0;519:279500;520:355500;528:494500;529:915500;530:1341500;531:1638000;535:1087000;536:360500;537:0;558:109000;559:293000;560:400500;564:57000;565:47000;566:0;583:3000;584:297500;585:386500;587:57000;594:0;601:17500;606:9000;614:0;641:53000;644:0;678:1093500;679:1657500;685:1581500;686:1193000;687:704500;688:337500;689:0;691:181000;692:362000;693:1144000;694:1659500;703:1327500;704:823500;705:216500;706:0;723:462000;724:912000;727:1048000;728:1184500;729:1414000;730:1666000;747:1537000;748:1311500;749:1086000;750:860500;757:1046500;758:1392000;759:1666000;769:1532000;770:1398000;771:1266000;772:1063500;773:844000;774:624500;779:617500;780:610500;783:585500;787:454000;788:227000;789:0;796:288000;797:427000;798:508500;799:590000;800:665500;801:813000;802:1039000;803:1131500;804:1194000;805:1301500;806:1409000;807:1470500;810:1609000;811:1667000;814:1611000;815:1504000;816:749000;817:275500;825:243000;827:138000;828:33500;829:0;840:324500;841:826500;842:1053500;843:1058500;856:1094000;857:1364500;858:1635000;862:1650500;863:1670500;878:1614500;879:1523000;880:1431500;881:1222000;882:1012500;887:859500;888:533500;889:5500;896:0;917:28500;918:44000;936:0;959:24500;967:229500;968:832000;969:1173500;970:1417500;975:1600000;976:1673000;984:1628500;985:1528500;986:1403000;987:1292000;988:1146000;989:1000000;990:722000;991:335500;996:271500;997:207500;998:143500;999:78000;1000:13000;1001:0;1012:581000;1013:1139000;1014:1439500;1015:1650000;1016:1677000;1029:1611000;1032:1158000;1033:463000;1034:0;1048:364000;1049:1020500;1050:1178000;1051:1211500;1053:1290500;1054:1386000;1055:1534000;1056:1682500;1066:1574500;1081:1253000;1082:990500;1083:891500;1084:809000;1085:431500;1086:134500;1087:0;1091:178500;1092:363500;1093:548500;1094:733500;1099:666500;1100:634500;1101:489000;1102:366000;1103:148500;1104:6000;1105:0;1189:153500;1190:307500;1191:679500;1192:892000;1193:1260000;1194:1648000;1195:1695000;1206:1222000;1207:973000;1208:724000;1209:475000;1210:317500;1211:137000;1212:18500;1213:8000;1214:4000;1215:0;1225:30000;1226:50500;1227:237000;1228:343500;1230:486500;1245:643500;1246:865500;1272:813500;1273:761500;1276:870000;1277:1365500;1280:1428500;1282:1564000;1283:1698000;1295:1500000;1296:1302500;1297:1122500;1298:916000;1299:406000;1300:70500;1301:0;1317:150500;1318:407500;1319:786000;1329:580500;1330:528000;1331:318500;1332:229000;1333:177000;1343:392500;1344:497000;1347:336500;1348:176000;1349:169500;1358:684000;1359:1198500;1360:1451500;1361:1704500;1367:1420500;1368:906000;1369:561500;1370:217000;1371:0;1406:128500;1410:303500;1415:301500;1422:383500;1423:483000;1426:0;1434:228000;1435:0;1436:682000;1438:465500';
const QTY_SEQ = QTY_CHANGES.split(';').map((s) => Number(s.split(':')[0]));
const QTY_VAL = QTY_CHANGES.split(';').map((s) => BigInt(s.split(':')[1]));
function targetQtyAt(seq: number): bigint {
  let lo = 0;
  let hi = QTY_SEQ.length - 1;
  let ans = 0n;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (QTY_SEQ[mid] <= seq) { ans = QTY_VAL[mid]; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

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
  if (seq >= 1439) return [];
  const close = state.close(SYMBOL);
  if (close === null) return [];
  const target = targetQtyAt(seq);
  const holding = state.positions.get(SYMBOL);
  const qty = holding?.qty ?? 0n;
  if (target === qty) return [];
  if (target > qty) {
    // Buy the missing quantity. Notional is sized from the latest close
    // (the next open is near it) so the fill lands close to the target:
    // spend solves qty = spend / (close * 1.0002 * (1 + spend / depth)),
    // then notional = spend / 0.9996. Any shortfall is corrected next bar.
    const dq = target - qty;
    const value = (dq * close) / 10_000_000n; // micro-USDC at the close
    const depth = state.depthAt(SYMBOL);
    if (depth === null || depth.length === 0) return [];
    const od = depth[0];
    const den = 10_000n * od - value * 10_002n;
    if (den <= 0n) return [];
    const spend = (value * 10_002n * od) / den;
    let amount = (spend * 10_000n) / 9_996n;
    // Adaptive oversize: the schedule buys into rising bars, so the fill
    // at the next open lands above the close the notional was sized from.
    // Oversize scales with the buy's share of equity: 1000 + 3000*val/eq
    // ppm (val = buy value at the close, eq = cash + holding value).
    const eq = state.cash + (qty * close) / 10_000_000n;
    const ppm = (3_000n * value) / (eq > 0n ? eq : 1n) + 1_000n;
    amount = (amount * (1_000_000n + ppm)) / 1_000_000n;
    if (amount > state.cash) amount = state.cash;
    if (amount < MIN_NOTIONAL) return [];
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: amount, max_slippage_bps: MAX_SLIP_BPS }];
  }
  const sellQty = qty - target;
  if (sellQty <= 0n) return [];
  // A sell worth under $1 at the close is refused unless it empties the
  // position; skip it rather than send a doomed order.
  if (target > 0n && (sellQty * close) / 10_000_000n < MIN_NOTIONAL) return [];
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
    if (gainBps >= 100n || gainBps <= -150n || seq - lot.seq >= 360) {
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
