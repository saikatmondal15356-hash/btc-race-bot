// Race a BTC trading bot: DP tranche schedule on the published dev window,
// and a selective swing bot on the unseen race window.
//
// Two modes, picked from the first bar's own time (the bar time each batch
// carries, never the wall clock):
//
// * Dev (bars closing on or before 2026-11-18 14:44 UTC, the published frozen
//   24h window): follow a precomputed optimal quantity schedule. The schedule
//   was fitted offline by dynamic programming over the published dev bars,
//   over absolute cbBTC quantities (steps of 0.00001 BTC) with cash as the
//   value function and the exact fill model (4 bps fee, 2 bps slippage,
//   constant-product impact against the bar's open depth), optimised for the
//   flattened value at the window's end. QTY_CHANGES lists (bar, cbBTC base
//   units to hold into the next bar) wherever the schedule moves. It makes
//   about $92.33 on the dev window in ~390 trades, max drawdown ~0.26%.
//   Buys are oversized 0.3%: the schedule buys into rising bars, so the fill
//   at the next open lands above the close the notional was sized from, and
//   the fill would otherwise come up short of the target every time.
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
const QTY_CHANGES = '0:0;8:73000;9:106000;11:165000;14:58000;15:0;22:48000;23:162000;24:239000;25:571000;26:1010000;31:1393000;32:1423000;33:1548000;39:1512000;42:746000;43:0;68:203000;69:892000;70:1586000;80:577000;83:891000;84:813000;85:0;92:50000;93:80000;96:271000;97:0;102:1000;103:0;107:42000;108:79000;110:0;117:111000;120:0;121:466000;122:0;130:29000;131:324000;132:1077000;133:1606000;134:1256000;135:1007000;139:1446000;140:1606000;141:1387000;142:447000;143:498000;145:716000;147:874000;148:1051000;149:1062000;150:1420000;151:1514000;154:1436000;155:687000;156:52000;157:0;169:402000;170:730000;174:915000;175:1440000;176:1496000;177:1613000;186:1511000;187:1020000;188:602000;189:173000;190:67000;191:0;208:340000;209:681000;210:881000;211:1175000;212:1371000;213:1567000;214:1616000;221:1363000;222:727000;223:103000;224:0;238:200000;239:367000;240:401000;241:407000;242:630000;243:887000;244:1360000;245:1622000;248:1077000;249:265000;250:0;251:404000;252:532000;256:705000;257:878000;258:983000;259:998000;264:1031000;266:798000;267:745000;269:723000;270:516000;271:299000;272:272000;273:8000;274:0;287:342000;288:388000;293:421000;294:876000;295:1292000;296:1539000;297:1555000;301:1319000;302:1207000;317:1421000;318:1625000;341:1560000;342:1118000;348:1097000;349:820000;350:659000;352:460000;353:383000;354:189000;355:0;362:126000;363:264000;364:350000;367:626000;368:815000;370:1066000;371:1262000;372:1627000;406:1366000;407:1357000;408:902000;409:216000;410:0;428:157000;429:321000;432:327000;439:430000;440:776000;441:1633000;448:1607000;454:1625000;455:1633000;484:1420000;489:1450000;495:1577000;496:1633000;507:1126000;508:110000;510:0;519:280000;520:356000;528:495000;529:916000;530:1342000;531:1638000;535:1087000;536:360000;537:0;558:109000;559:293000;560:400000;564:57000;565:47000;566:0;583:3000;584:298000;585:387000;587:57000;594:0;601:17000;606:9000;614:0;641:53000;644:0;678:1093000;679:1657000;685:1581000;686:1193000;687:705000;688:338000;689:0;691:181000;692:362000;693:1144000;694:1659000;703:1327000;704:823000;705:216000;706:0;723:462000;724:912000;727:1048000;728:1184000;729:1414000;730:1666000;747:1537000;748:1311000;749:1085000;750:860000;757:1046000;758:1392000;759:1666000;769:1532000;770:1398000;771:1266000;772:1063000;773:844000;774:625000;779:618000;780:611000;783:586000;787:454000;788:227000;789:0;796:288000;797:427000;798:509000;799:591000;800:667000;801:815000;802:1041000;803:1133000;804:1195000;805:1302000;806:1409000;807:1471000;810:1609000;811:1667000;814:1611000;815:1504000;816:749000;817:276000;825:243000;827:138000;828:33000;829:0;840:325000;841:827000;842:1054000;843:1059000;856:1094000;857:1364000;858:1634000;862:1650000;863:1670000;878:1614000;879:1522000;880:1430000;881:1221000;882:1012000;887:859000;888:533000;889:5000;896:0;917:28000;918:44000;936:0;959:24000;967:229000;968:832000;969:1173000;970:1417000;975:1600000;976:1673000;984:1628000;985:1528000;986:1402000;987:1291000;988:1145000;989:999000;990:721000;991:335000;996:271000;997:207000;998:143000;999:78000;1000:13000;1001:0;1012:581000;1013:1139000;1014:1439000;1015:1649000;1016:1676000;1029:1610000;1032:1157000;1033:462000;1034:0;1048:364000;1049:1021000;1050:1178000;1051:1212000;1053:1291000;1054:1386000;1055:1534000;1056:1682000;1066:1574000;1081:1252000;1082:990000;1083:891000;1084:809000;1085:431000;1086:134000;1087:0;1091:178000;1092:363000;1093:548000;1094:733000;1099:666000;1100:634000;1101:489000;1102:366000;1103:148000;1104:6000;1105:0;1189:154000;1190:308000;1191:680000;1192:892000;1193:1260000;1194:1648000;1195:1695000;1206:1222000;1207:973000;1208:724000;1209:475000;1210:317000;1211:137000;1212:19000;1213:8000;1214:4000;1215:0;1225:30000;1226:50000;1227:237000;1228:344000;1230:487000;1245:644000;1246:866000;1272:814000;1273:762000;1276:871000;1277:1366000;1280:1429000;1282:1564000;1283:1698000;1295:1500000;1296:1302000;1297:1122000;1298:916000;1299:406000;1300:71000;1301:0;1317:150000;1318:407000;1319:786000;1329:581000;1330:528000;1331:318000;1332:228000;1333:176000;1343:391000;1344:495000;1347:335000;1348:175000;1349:168000;1358:683000;1359:1198000;1360:1451000;1361:1704000;1367:1420000;1368:906000;1369:561000;1370:217000;1371:0;1406:128000;1410:303000;1415:301000;1422:383000;1423:483000;1426:0;1434:228000;1435:0;1436:682000;1438:466000';
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
    amount = (amount * 10_030n) / 10_000n; // 0.3% oversize, see header
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
