/**
 * Pine v6 coverage probe. Runs small v6 scripts (one or more per coverage row) through raw PineTS and through
 * Vost's runPine, on fixed synthetic candles (no network), and prints per case what each returned.
 * Run: `timeout 180 npx vite-node docs/spikes/pine-coverage/probe.ts > docs/spikes/pine-coverage/output.txt`
 * (vite-node because client/src/lib/pine/runtime.ts uses extensionless imports). Exits 0; deterministic.
 */
import { PineTS } from 'pinets';
import { runPine } from '../../../client/src/lib/pine/runtime';
import type { Candle } from '../../../client/src/types';

// 120 daily bars from 2023-11-14, a deterministic wave with a trend, so crosses and pivots occur.
const T0 = 1700000000 - (1700000000 % 86400);
const candles: Candle[] = Array.from({ length: 120 }, (_, i) => {
  const mid = 100 + i * 0.3 + 8 * Math.sin(i / 6);
  const open = mid + 1.5 * Math.cos(i / 2);
  const close = mid - 1.5 * Math.cos(i / 2);
  return {
    time: T0 + i * 86400,
    open: +open.toFixed(2),
    high: +(Math.max(open, close) + 1 + (i % 4) * 0.2).toFixed(2),
    low: +(Math.min(open, close) - 1 - (i % 3) * 0.2).toFixed(2),
    close: +close.toFixed(2),
    volume: 1000 + ((i * 37) % 200),
  };
});
const pineData = candles.map((c, i) => ({
  openTime: c.time * 1000,
  closeTime: (i + 1 < candles.length ? candles[i + 1].time : c.time + 86400) * 1000 - 1,
  open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
}));

const IND = '//@version=6\nindicator("c", overlay=true)\n';
const STRAT = '//@version=6\nstrategy("c", overlay=true, initial_capital=10000)\n';
const ENTRY = 'if ta.crossover(close, ta.sma(close, 10))\n    strategy.entry("L", strategy.long)\nif ta.crossunder(close, ta.sma(close, 10))\n    strategy.close("L")\n';

interface Case { row: string; id: string; src: string; libs?: Record<string, string> }
const cases: Case[] = [];
const ind = (row: string, id: string, body: string) => cases.push({ row, id, src: IND + body });
const strat = (row: string, id: string, body: string) => cases.push({ row, id, src: STRAT + body });
const full = (row: string, id: string, src: string) => cases.push({ row, id, src });

// language
ind('language', 'udt', 'type P\n    float x\n    float y\np = P.new(close, open)\nplot(p.x - p.y)');
ind('language', 'method', 'method double(float v) => v * 2\nplot(close.double())');
ind('language', 'enum', 'enum Mode\n    a\n    b\nm = Mode.a\nplot(m == Mode.a ? 1 : 2)');
ind('language', 'function-switch-for', 'f(x) =>\n    switch\n        x > 110 => 1\n        => 0\ns = 0\nfor i = 0 to 4\n    s += i\nplot(f(close) + s)');
ind('language', 'varip', 'varip int n = 0\nn += 1\nplot(n)');
ind('language', 'var-persist', 'var int n = 0\nn += 1\nplot(n)');
// An inline library through a resolver (no network): what the Vost server's /api/pine/libraries gives runPine by default.
cases.push({ row: 'language', id: 'import-library', src: IND + 'import probe/Lib/1 as lib\nplot(lib.double(close))', libs: { 'probe/Lib/1': '//@version=6\nlibrary("Lib")\nexport double(float x) => x * 2\n' } });
ind('language', 'tuple-return', 'f() => [close, open]\n[a, b] = f()\nplot(a - b)');
ind('language', 'while-break', 'i = 0\nwhile i < 5\n    i += 1\nplot(i)');
// ta
ind('ta', 'sma-ema-rma-wma', 'plot(ta.sma(close,10), "sma")\nplot(ta.ema(close,10), "ema")\nplot(ta.rma(close,10), "rma")\nplot(ta.wma(close,10), "wma")');
ind('ta', 'rsi-macd-bb', 'plot(ta.rsi(close,14), "rsi")\n[m,s,h] = ta.macd(close,12,26,9)\nplot(m, "macd")\n[u,mid,l] = ta.bb(close,20,2)\nplot(u, "bbu")');
ind('ta', 'atr-stoch-adx', 'plot(ta.atr(14), "atr")\nplot(ta.stoch(close,high,low,14), "stoch")\n[p,mn,adx] = ta.dmi(14,14)\nplot(adx, "adx")');
ind('ta', 'supertrend-sar', '[st, dir] = ta.supertrend(3, 10)\nplot(st, "st")\nplot(ta.sar(0.02,0.02,0.2), "sar")');
ind('ta', 'pivots-highest', 'plot(ta.pivothigh(high,3,3), "ph")\nplot(ta.highest(high,10), "hh")\nplot(ta.lowestbars(low,10), "lb")');
ind('ta', 'vwap-obv-cci-mfi', 'plot(ta.vwap, "vwap")\nplot(ta.obv, "obv")\nplot(ta.cci(close,20), "cci")\nplot(ta.mfi(hlc3,14), "mfi")');
ind('ta', 'kc-keltner', '[a,b,c] = ta.kc(close,20,2)\nplot(a, "kc")');
ind('ta', 'correlation-linreg', 'plot(ta.correlation(close,open,10), "corr")\nplot(ta.linreg(close,10,0), "lr")\nplot(ta.percentrank(close,10), "pr")');
// math / str
ind('math', 'math-basic', 'plot(math.abs(-1) + math.max(1,2) + math.round(1.5) + math.sqrt(4) + math.pow(2,3) + math.log(10) + math.sum(close,3))');
ind('math', 'math-random', 'plot(math.random(0,1,42))');
ind('str', 'str-basic', 's = str.tostring(close, "#.##") + str.upper("a") + str.format("{0}-{1}", 1, 2)\nplot(str.length(s))');
ind('str', 'str-split-replace', 'a = str.split("a,b,c", ",")\nplot(array.size(a) + str.pos("abc","c") + str.tonumber("5"))');
// containers
ind('array', 'array-basic', 'a = array.new<float>()\narray.push(a, close)\narray.push(a, open)\nplot(array.avg(a) + array.size(a) + array.max(a))');
ind('array', 'array-sort-slice', 'a = array.from(3.0,1.0,2.0)\narray.sort(a)\nplot(array.get(a,0) + array.size(array.slice(a,0,2)))');
ind('matrix', 'matrix-basic', 'm = matrix.new<float>(2,2,1.0)\nmatrix.set(m,0,1,5.0)\nplot(matrix.get(m,0,1) + matrix.rows(m))');
ind('matrix', 'matrix-det', 'm = matrix.new<float>(2,2,1.0)\nmatrix.set(m,0,0,3.0)\nplot(matrix.det(m))');
ind('map', 'map-basic', 'm = map.new<string,float>()\nmap.put(m,"a",close)\nplot(map.get(m,"a") + map.size(m))');
// color
ind('color', 'color-basic', 'c = color.new(color.red, 50)\nplot(close, color=color.from_gradient(close, 90, 130, color.blue, c))');
ind('color', 'color-rgb-components', 'c = color.rgb(10,20,30,40)\nplot(color.r(c) + color.g(c) + color.b(c) + color.t(c))');
// input
ind('input', 'input-int-float-bool-string', 'a = input.int(5,"A",minval=1,maxval=20)\nb = input.float(1.5,"B",step=0.1)\nc = input.bool(true,"C")\nd = input.string("x","D",options=["x","y"])\nplot(a + b + (c?1:0) + str.length(d))');
ind('input', 'input-source-color-timeframe', 's = input.source(close,"S")\nc = input.color(color.red,"C")\nt = input.timeframe("D","T")\nplot(s, color=c)');
ind('input', 'input-time-symbol-session', 'sy = input.symbol("BTCUSDT","Sy")\ntm = input.time(timestamp("2023-12-01"),"Tm")\nss = input.session("0900-1600","Ss")\nplot(tm > 0 ? 1 : 0)');
ind('input', 'input-group-tooltip-inline', 'a = input.int(5,"A",group="g",tooltip="t",inline="i")\nplot(a)');
// syminfo / timeframe / barstate
ind('syminfo', 'syminfo-numbers', 'plot(syminfo.mintick, "mintick")\nplot(syminfo.pointvalue, "pv")\nplot(syminfo.mincontract, "mincontract")');
ind('syminfo', 'syminfo-strings', 'plot(str.length(syminfo.tickerid), "len tickerid")\nplot(syminfo.ticker == "VOST" ? 1 : 0, "ticker is VOST")\nplot(str.length(syminfo.timezone), "len timezone")\nplot(str.length(syminfo.currency), "len currency")\nplot(str.length(syminfo.type), "len type")\nplot(str.length(syminfo.session), "len session")\nplot(str.length(syminfo.description), "len description")');
ind('syminfo', 'syminfo-ticker-text', 'label.new(bar_index, high, syminfo.ticker + "|" + syminfo.prefix + "|" + syminfo.currency, size=size.tiny)\nplot(0)');
ind('timeframe', 'timeframe-fields', 'plot(timeframe.in_seconds(), "secs")\nplot(timeframe.isdaily ? 1 : 0, "isd")\nplot(timeframe.multiplier, "mult")\nplot(str.length(timeframe.period), "plen")');
ind('timeframe', 'timeframe-change-from-seconds', 'plot(timeframe.change("W") ? 1 : 0, "chg")\nplot(timeframe.from_seconds(3600) == "60" ? 1 : 0)');
ind('barstate', 'barstate-fields', 'plot(barstate.isfirst ? 1 : 0, "first")\nplot(barstate.islast ? 1 : 0, "last")\nplot(barstate.isconfirmed ? 1 : 0, "conf")\nplot(barstate.isrealtime ? 1 : 0, "rt")\nplot(barstate.ishistory ? 1 : 0, "hist")\nplot(barstate.isnew ? 1 : 0, "new")');
// session / time
ind('session-time', 'time-vars', 'plot(dayofweek, "dow")\nplot(month, "mon")\nplot(hour, "h")\nplot(year, "y")\nplot(time > 0 ? 1 : 0, "t")\nplot(time_close > time ? 1 : 0, "tc")');
ind('session-time', 'time-functions', 'plot(timestamp(2023, 12, 1, 0, 0) > 0 ? 1 : 0, "ts")\nplot(dayofweek(time) + weekofyear(time), "dw")');
ind('session-time', 'time-session-0000-2359', 'plot(time(timeframe.period, "0000-2359") ? 1 : 0, "in session")');
ind('session-time', 'time-session-0000-2400', 'plot(time(timeframe.period, "0000-2400") ? 1 : 0, "in session")');
ind('session-time', 'time-session-timezone', 'plot(time(timeframe.period, "0930-1600", "America/New_York") ? 1 : 0, "in session")');
ind('session-time', 'session-vars', 'plot(session.ismarket ? 1 : 0, "mkt")\nplot(session.isfirstbar ? 1 : 0, "fb")\nplot(session.islastbar ? 1 : 0, "lb")');
ind('session-time', 'last-bar-time', 'plot(last_bar_time > 0 ? 1 : 0, "lbt")\nplot(bar_index, "bi")\nplot(last_bar_index, "lbi")\nplot(na(nz(close)) ? 1 : 0, "na")');
// request
ind('request', 'security-same-tf', 'plot(request.security(syminfo.tickerid, "D", close), "sec")');
ind('request', 'security-higher-tf', 'plot(request.security(syminfo.tickerid, "W", open), "weekly open")\nplot(open, "daily open")');
ind('request', 'security-other-symbol', 'plot(request.security("AAPL", "D", close), "AAPL close")\nplot(close, "chart close")');
ind('request', 'security-lower-tf', 'a = request.security_lower_tf(syminfo.tickerid, "60", close)\nplot(array.size(a), "n")');
ind('request', 'request-financial', 'plot(request.financial("NASDAQ:AAPL", "TOTAL_REVENUE", "FQ"), "fin")');
ind('request', 'request-economic', 'plot(request.economic("US", "GDP"), "gdp")');
ind('request', 'request-seed', 'plot(request.seed("a", "b", close), "seed")');
ind('request', 'request-dividends-splits-earnings', 'plot(request.dividends("NASDAQ:AAPL"), "div")\nplot(request.splits("NASDAQ:AAPL"), "spl")\nplot(request.earnings("NASDAQ:AAPL"), "ear")');
// plot family
ind('plot', 'plot-styles', 'plot(close, "line")\nplot(open, "stepline", style=plot.style_stepline)\nplot(high, "hist", style=plot.style_histogram)\nplot(low, "cross", style=plot.style_cross)\nplot(close, "area", style=plot.style_area)\nplot(close, "cols", style=plot.style_columns)');
ind('plot', 'plot-color-linewidth-offset', 'plot(close, "p", color=close>open?color.green:color.red, linewidth=3, offset=2, trackprice=true, join=true)');
ind('hline', 'hline-basic', 'hline(100, "h", color=color.gray, linestyle=hline.style_dashed)');
ind('fill', 'fill-plots', 'p1 = plot(ta.sma(close,5), "a")\np2 = plot(ta.sma(close,20), "b")\nfill(p1, p2, color=color.new(color.blue, 80))');
ind('fill', 'fill-hlines', 'h1 = hline(100)\nh2 = hline(120)\nfill(h1, h2, color=color.new(color.green, 80))');
ind('bgcolor', 'bgcolor-basic', 'bgcolor(close > open ? color.new(color.green, 85) : na)');
ind('barcolor', 'barcolor-basic', 'barcolor(close > open ? color.green : color.red)');
ind('plotshape', 'plotshape-basic', 'plotshape(close > open, "ps", style=shape.triangleup, location=location.belowbar, color=color.green, text="B")');
ind('plotchar', 'plotchar-basic', 'plotchar(close > open, "pc", "x", location=location.abovebar)');
ind('plotarrow', 'plotarrow-basic', 'plotarrow(close - open, "pa")');
ind('plotcandle', 'plotcandle-basic', 'plotcandle(open, high, low, close, "pcd", color=color.green, wickcolor=color.gray, bordercolor=color.black)');
ind('plotbar', 'plotbar-basic', 'plotbar(open, high, low, close, "pb")');
// drawings
ind('line', 'line-basic', 'if barstate.islast\n    line.new(bar_index-10, low, bar_index, high, color=color.blue, width=2)\nplot(0)');
ind('label', 'label-basic', 'if barstate.islast\n    label.new(bar_index, high, "hi", style=label.style_label_down, color=color.red)\nplot(0)');
ind('box', 'box-basic', 'if barstate.islast\n    box.new(bar_index-10, high, bar_index, low, border_color=color.blue, bgcolor=color.new(color.blue, 80))\nplot(0)');
ind('table', 'table-basic', 'var t = table.new(position.top_right, 2, 2)\nif barstate.islast\n    table.cell(t, 0, 0, "a")\n    table.cell(t, 1, 1, "b")\nplot(0)');
ind('polyline', 'polyline-basic', 'if barstate.islast\n    pts = array.new<chart.point>()\n    array.push(pts, chart.point.from_index(bar_index-5, low))\n    array.push(pts, chart.point.from_index(bar_index, high))\n    polyline.new(pts)\nplot(0)');
ind('linefill', 'linefill-basic', 'if barstate.islast\n    l1 = line.new(bar_index-10, low, bar_index, low)\n    l2 = line.new(bar_index-10, high, bar_index, high)\n    linefill.new(l1, l2, color.new(color.blue, 80))\nplot(0)');
ind('chart', 'chart-vars', 'plot(chart.is_standard ? 1 : 0, "std")\nplot(chart.is_heikinashi ? 1 : 0, "ha")\nplot(chart.bg_color == color.white ? 1 : 0, "bg")\nplot(chart.left_visible_bar_time > 0 ? 1 : 0, "lv")');
// alerts, log, runtime
ind('alert', 'alertcondition', 'alertcondition(close > 0, "always", "msg")\nplot(close)');
ind('alert', 'alert-fn', 'if close > 0\n    alert("crossed", alert.freq_once_per_bar)\nplot(close)');
ind('log', 'log-info-warning-error', 'log.info("i {0}", close)\nlog.warning("w")\nlog.error("e")\nplot(close)');
ind('runtime', 'runtime-error', 'if bar_index == 50\n    runtime.error("boom")\nplot(close)');
full('runtime', 'max-bars-back', '//@version=6\nindicator("c", overlay=true, max_bars_back=50)\nplot(close[40])');
// declaration
full('declaration', 'indicator-args', '//@version=6\nindicator("D", shorttitle="d", overlay=false, format=format.volume, precision=3, scale=scale.left, max_bars_back=100, timeframe="", explicit_plot_zorder=true, max_lines_count=50)\nplot(close)');
full('declaration', 'indicator-timeframe-arg', '//@version=6\nindicator("D", timeframe="W")\nplot(close)');
full('declaration', 'indicator-overlay-false', '//@version=6\nindicator("D", overlay=false)\nplot(close)');
// strategy
full('strategy', 'strategy-entry-close', STRAT + ENTRY);
strat('strategy', 'strategy-short', 'if ta.crossunder(close, ta.sma(close,10))\n    strategy.entry("S", strategy.short)\nif ta.crossover(close, ta.sma(close,10))\n    strategy.close("S")');
strat('strategy', 'strategy-exit-stop-limit', 'if ta.crossover(close, ta.sma(close,10))\n    strategy.entry("L", strategy.long)\nstrategy.exit("X", "L", stop=close*0.97, limit=close*1.05)');
strat('strategy', 'strategy-order-close-all', 'if bar_index % 20 == 0\n    strategy.order("O", strategy.long, 1)\nif bar_index % 20 == 10\n    strategy.close_all()');
strat('strategy', 'strategy-limit-stop-entry', 'if bar_index % 30 == 0\n    strategy.entry("L", strategy.long, limit=close*0.99)\nif bar_index % 30 == 15\n    strategy.entry("S", strategy.short, stop=close*0.99)\nif bar_index % 30 == 25\n    strategy.close_all()');
strat('strategy', 'strategy-cancel', 'if bar_index % 10 == 0\n    strategy.entry("L", strategy.long, limit=close*0.5)\nif bar_index % 10 == 5\n    strategy.cancel("L")');
full('strategy', 'strategy-risk', '//@version=6\nstrategy("c", overlay=true)\nstrategy.risk.max_drawdown(10, strategy.percent_of_equity)\nstrategy.risk.max_intraday_loss(5, strategy.percent_of_equity)\nstrategy.risk.allow_entry_in(strategy.direction.long)\n' + ENTRY);
full('strategy', 'strategy-commission-slippage', '//@version=6\nstrategy("c", overlay=true, initial_capital=10000, commission_type=strategy.commission.percent, commission_value=0.1, slippage=2)\n' + ENTRY);
full('strategy', 'strategy-pyramiding', '//@version=6\nstrategy("c", overlay=true, pyramiding=3)\nif bar_index % 5 == 0\n    strategy.entry("L" + str.tostring(bar_index), strategy.long)\nif bar_index % 25 == 24\n    strategy.close_all()');
full('strategy', 'strategy-qty-percent-equity', '//@version=6\nstrategy("c", overlay=true, default_qty_type=strategy.percent_of_equity, default_qty_value=50)\n' + ENTRY);
full('strategy', 'strategy-margin-fill-orders', '//@version=6\nstrategy("c", overlay=true, margin_long=50, margin_short=50, process_orders_on_close=true, calc_on_every_tick=true, close_entries_rule="ANY")\n' + ENTRY);
strat('strategy-vars', 'strategy-builtin-vars', 'plot(strategy.position_size, "pos")\nplot(strategy.equity, "eq")\nplot(strategy.netprofit, "net")\nplot(strategy.opentrades, "open")\nplot(strategy.closedtrades, "closed")\nplot(strategy.wintrades, "wins")\nplot(strategy.position_avg_price, "avg")\nplot(strategy.initial_capital, "ic")\nplot(strategy.max_drawdown, "mdd")\n' + ENTRY);
strat('strategy-vars', 'strategy-trade-accessors', 'plot(strategy.closedtrades.profit(0), "p0")\nplot(strategy.closedtrades.entry_price(0), "e0")\nplot(strategy.opentrades.size(0), "s0")\n' + ENTRY);


// One case per built-in, to find the ones PineTS lacks. Each plots one value.
const TA_FNS = [
  'ta.alma(close,9,0.85,6)', 'ta.barssince(close>open)', 'ta.bbw(close,20,2)', 'ta.cci(close,20)', 'ta.change(close)', 'ta.cmo(close,9)',
  'ta.cog(close,10)', 'ta.cum(volume)', 'ta.dev(close,10)', 'ta.falling(close,3) ? 1 : 0', 'ta.highestbars(high,10)', 'ta.hma(close,9)',
  'ta.kcw(close,20,2)', 'ta.mom(close,10)', 'ta.roc(close,10)', 'ta.rising(close,3) ? 1 : 0', 'ta.stdev(close,10)', 'ta.swma(close)',
  'ta.tr', 'ta.tsi(close,5,13)', 'ta.valuewhen(close>open,close,0)', 'ta.variance(close,10)', 'ta.vwma(close,10)', 'ta.wpr(14)',
  'ta.cross(close, ta.sma(close,10)) ? 1 : 0', 'ta.median(close,10)', 'ta.mode(close,10)', 'ta.percentile_linear_interpolation(close,10,50)',
  'ta.percentile_nearest_rank(close,10,50)', 'ta.range(close,10)', 'ta.max(close)', 'ta.min(close)', 'ta.rci(close,10)', 'ta.ema(close,10)',
  'ta.accdist', 'ta.iii', 'ta.nvi', 'ta.pvi', 'ta.pvt', 'ta.wad', 'ta.wvad', 'ta.vwap(close)', 'ta.supertrend(3,10)[0]', 'ta.dmi(14,14)[0]',
  'ta.macd(close,12,26,9)[0]', 'ta.stoch(close,high,low,14)', 'ta.sar(0.02,0.02,0.2)', 'ta.pivotlow(low,3,3)',
];
for (const e of TA_FNS) ind('ta', `fn ${e}`, `plot(${e})`);
const MATH_FNS = [
  'math.abs(-2)', 'math.acos(0.5)', 'math.asin(0.5)', 'math.atan(1)', 'math.ceil(1.2)', 'math.cos(1)', 'math.exp(1)', 'math.floor(1.8)',
  'math.log10(100)', 'math.max(1,2,3)', 'math.min(1,2,3)', 'math.round_to_mintick(close)', 'math.sign(-3)', 'math.sin(1)', 'math.tan(1)',
  'math.todegrees(1)', 'math.toradians(180)', 'math.avg(1,2,3)', 'math.e + math.pi + math.phi + math.rphi', 'math.sum(close,5)',
];
for (const e of MATH_FNS) ind('math', `fn ${e}`, `plot(${e})`);

// ---------------------------------------------------------------------------------------------------------

/** Live drawing objects PineTS collected (a collection holds them in data[0].value; deleted ones are flagged). */
function size(v: any): number {
  const items = v?.data?.[0]?.value;
  return Array.isArray(items) ? items.filter((d: any) => !d?._deleted).length : 0;
}
const fmt = (v: unknown): string =>
  typeof v === 'number' ? String(+v.toFixed(4)) : Array.isArray(v) ? `[${v.length} values]` : v === null || v === undefined ? 'na' : String(v);
const short = (s: string, n = 110) => (s.length > n ? s.slice(0, n) + '...' : s).replace(/\s+/g, ' ');

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
/** Silence the console while a script runs (Pine log.* prints there) and count the lines. */
function mute(): { lines: () => number; restore: () => void } {
  const saved = METHODS.map((m) => console[m]);
  let n = 0;
  for (const m of METHODS) console[m] = () => { n++; };
  return { lines: () => n, restore: () => METHODS.forEach((m, i) => { console[m] = saved[i]; }) };
}

async function rawRun(src: string, libs?: Record<string, string>): Promise<string> {
  const quiet = mute();
  try {
    const pine = new PineTS(pineData, 'VOST', 'D');
    if (libs) pine.setImportResolver((p) => libs[p] ?? null);
    const ctx: any = await pine.run(src);
    const plots = ctx.plots ?? {};
    const keys = Object.keys(plots).filter((k) => !k.startsWith('__'));
    const drawings = Object.keys(plots)
      .filter((k) => k.startsWith('__'))
      .map((k) => `${k.replace(/_/g, '')}=${size(plots[k])}`)
      .filter((s) => !s.endsWith('=0'));
    const last = (k: string) => fmt(plots[k]?.data?.[plots[k].data.length - 1]?.value);
    const parts = [`plots[${keys.length}]: ${keys.map((k) => `${k}=${last(k)}`).join(', ') || '-'}`];
    // non-numeric first value (candle arrays, booleans) shows what plot data holds
    const nonNum = keys.filter((k) => plots[k]?.data?.some((p: any) => typeof p.value !== 'number' && p.value != null));
    if (nonNum.length) parts.push(`non-number values in: ${nonNum.join(', ')}`);
    if (drawings.length) parts.push(`drawings: ${drawings.join(' ')}`);
    if (ctx.alerts?.length) parts.push(`alerts: ${ctx.alerts.length} (${[...new Set(ctx.alerts.map((a: any) => a.type))].join('/')}, bar ${[...new Set(ctx.alerts.map((a: any) => a.bar_index))].join('/')})`);
    if (ctx.warnings?.length) parts.push(`warnings: ${ctx.warnings.length}`);
    if (quiet.lines()) parts.push(`console lines: ${quiet.lines()}`);
    if (ctx.strategy && Array.isArray(ctx.strategy.closedtrades)) {
      const net = ctx.strategy.closedtrades.reduce((a: number, t: any) => a + (Number(t.profit) || 0), 0);
      parts.push(`strategy: closed=${ctx.strategy.closedtrades.length} open=${ctx.strategy.opentrades.length} closed-profit=${+net.toFixed(2)}`);
    }
    return 'ok  ' + parts.join(' | ');
  } catch (e: any) {
    return 'ERR ' + short(String(e?.message ?? e));
  } finally {
    quiet.restore();
  }
}

async function vostRun(src: string, libs?: Record<string, string>): Promise<string> {
  const quiet = mute();
  try {
    const r = await runPine(src, candles, {}, libs ? { resolver: (p) => libs[p] ?? null } : undefined);
    if (!r.ok) return 'ERR ' + short(r.error.message);
    const plots = r.plots.map((p) => `${p.name}:${p.kind}/${p.style}/${p.pane}=${fmt(p.values[p.values.length - 1])}`);
    const allNull = r.plots.filter((p) => p.values.every((v) => v === null)).map((p) => p.name);
    let s = `ok  plots[${plots.length}]: ${plots.join(', ') || '-'}`;
    if (allNull.length) s += ` | all-null: ${allNull.join(', ')}`;
    if (r.inputs.length) s += ` | inputs: ${r.inputs.map((i) => `${i.name}:${i.type}`).join(', ')}`;
    if (r.kind === 'strategy') {
      const net = r.trades.reduce((a, t) => a + (t.profit ?? 0), 0);
      s += ` | trades=${r.trades.length} (open ${r.trades.filter((t) => t.exitIndex === null).length}) closed-profit=${+net.toFixed(2)}`;
    }
    s += ` | declaration overlay=${r.declaration.overlay}`;
    return s;
  } finally {
    quiet.restore();
  }
}

console.log(`Pine v6 coverage probe: ${cases.length} cases, ${candles.length} synthetic daily candles from ${new Date(candles[0].time * 1000).toISOString().slice(0, 10)}, PineTS ticker VOST timeframe D`);
for (const c of cases) {
  console.log(`\n## ${c.row} / ${c.id}`);
  console.log(`  pinets : ${await rawRun(c.src, c.libs)}`);
  console.log(`  runPine: ${await vostRun(c.src, c.libs)}`);
}

// Vost always passes timeframe 'D' to PineTS, whatever the chart shows: feed hourly candles to runPine.
{
  const hourly = candles.map((c, i) => ({ ...c, time: T0 + i * 3600 }));
  const src = IND + 'plot(timeframe.in_seconds(), "in_seconds")\nplot(timeframe.isintraday ? 1 : 0, "isintraday")\nplot(timeframe.isdaily ? 1 : 0, "isdaily")\nplot((time_close - time) / 1000, "bar length s")';
  const quiet = mute();
  let line: string;
  try {
    const r = await runPine(src, hourly);
    line = r.ok ? r.plots.map((p) => `${p.name}=${fmt(p.values[p.values.length - 1])}`).join(', ') : 'ERR ' + r.error.message;
  } finally {
    quiet.restore();
  }
  console.log('\n## timeframe / runPine on 1h candles');
  console.log(`  runPine: ${line}`);
}
