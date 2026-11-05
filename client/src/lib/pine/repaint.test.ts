import { afterEach, describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { runPineBacktest } from '../backtest/pine';
import { setDefaultMarketFeed } from './marketFeed';
import { runPine } from './runtime';
import { candles15, fakeServer, hourlyOf } from './securityFixture';
import type { PineMarket } from './types';

const base = candles15(96 * 60);
// Ends inside a day, so the newest day is still forming
const chart = hourlyOf(base).slice(0, 24 * 59 + 9);
const feed = () => fakeServer(base, { markets: { 'binance|BTCUSDT': base, 'bybit|ETHUSDT': candles15(96 * 60, 7, 50) } }).feed;
const market: PineMarket = { providerId: 'binance', symbol: 'BTCUSDT', interval: '1h' };
const finished: PineMarket = { ...market, higherBars: 'finished' };
const head = (decl = 'indicator("r", overlay=true)') => `//@version=6\n${decl}\n`;
// The last 30 hourly bars, spanning a day boundary (bar 24*59+... is inside the last day)
const WINDOW = 30;

async function plotValues(src: string, candles: Candle[], m: PineMarket) {
  const r = await runPine(src, candles, {}, { market: m, feed: feed() });
  if (!r.ok) throw new Error(r.error.message);
  return r.plots[0].values;
}

/** Replays the chart bar by bar as a live chart would: each run sees the candles up to bar k and its last value is kept. */
async function liveRun(src: string, m: PineMarket) {
  const out: Array<number | null> = [];
  for (let k = chart.length - WINDOW + 1; k <= chart.length; k++) {
    const v = await plotValues(src, chart.slice(0, k), m);
    out.push(v[v.length - 1] as number | null);
  }
  return out;
}
async function fullRun(src: string, m: PineMarket) {
  return (await plotValues(src, chart, m)).slice(-WINDOW) as Array<number | null>;
}

describe('closed bars never change (default market)', () => {
  const cases: Record<string, string> = {
    ema: 'plot(ta.ema(close, 10))',
    counter: 'var int n = 0\nn += 1\nplot(n)',
    crossover: 'plot(ta.crossover(ta.sma(close, 3), ta.sma(close, 8)) ? 1 : 0)',
  };
  for (const [name, body] of Object.entries(cases)) {
    it(`${name}: a live bar-by-bar run equals one full run`, async () => {
      const src = head() + body;
      expect(await liveRun(src, market)).toEqual(await fullRun(src, market));
    });
  }

  it('a small strategy gives the same closed trades live and in one run', async () => {
    const src = head('strategy("s", overlay=true)') + 'if ta.crossover(ta.sma(close, 3), ta.sma(close, 8))\n    strategy.entry("L", strategy.long)\nif ta.crossunder(ta.sma(close, 3), ta.sma(close, 8))\n    strategy.close("L")\nplot(close)';
    const trades = async (candles: Candle[]) => {
      const r = await runPine(src, candles, {}, { market, feed: feed() });
      if (!r.ok) throw new Error(r.error.message);
      return r.trades.filter((t) => t.exitTime != null);
    };
    const full = await trades(chart);
    const cut = chart.length - 100;
    const live = await trades(chart.slice(0, cut));
    expect(full.length).toBeGreaterThan(2);
    expect(full.slice(0, live.length)).toEqual(live);
  });

  it('request.security with lookahead_off already holds the last finished value on the live bar, so it equals a full run', async () => {
    const src = head() + 'plot(request.security(syminfo.tickerid, "D", close))';
    expect(await liveRun(src, market)).toEqual(await fullRun(src, market));
  });

  it('a declared higher timeframe follows the forming bar live and differs from a reload (TradingView behaviour, documented)', async () => {
    const src = head('indicator("d", overlay=true, timeframe="D", timeframe_gaps=false)') + 'plot(close)';
    expect(await liveRun(src, market)).not.toEqual(await fullRun(src, market));
  });
});

describe('higherBars finished: live equals one full run', () => {
  const cases: Record<string, string> = {
    'security daily, same symbol': head() + 'plot(request.security(syminfo.tickerid, "D", close))',
    'security 720, same symbol': head() + 'plot(request.security(syminfo.tickerid, "720", ta.sma(close, 3)))',
    'security another symbol': head() + 'plot(request.security("BYBIT:ETHUSDT", "D", close))',
    'declared D, gaps on': head('indicator("d", overlay=true, timeframe="D")') + 'plot(close)',
    'declared D, gaps off': head('indicator("d", overlay=true, timeframe="D", timeframe_gaps=false)') + 'plot(close)',
  };
  for (const [name, src] of Object.entries(cases)) {
    it(name, async () => {
      const live = await liveRun(src, finished);
      expect(live).toEqual(await fullRun(src, finished));
      expect(live.some((v) => v !== null)).toBe(true);
    });
  }

  it('lower timeframes and close[1] with lookahead_on match the default market', async () => {
    for (const body of ['plot(request.security(syminfo.tickerid, "15", close))', 'plot(request.security(syminfo.tickerid, "D", close[1], lookahead = barmerge.lookahead_on))']) {
      const src = head() + body;
      expect(await fullRun(src, finished)).toEqual(await fullRun(src, market));
    }
  });

  it('a backtest through runPineBacktest gives the chart run\'s trades', async () => {
    const src = head('strategy("s", overlay=true)') + 'd = request.security(syminfo.tickerid, "D", close)\nif ta.crossover(close, d)\n    strategy.entry("L", strategy.long)\nif ta.crossunder(close, d)\n    strategy.close("L")\nplot(close)';
    const chartRun = await runPine(src, chart, {}, { market: finished, feed: feed() });
    if (!chartRun.ok) throw new Error(chartRun.error.message);
    setDefaultMarketFeed(feed());
    const bt = await runPineBacktest(chart, { strategyId: 'pine', pineCode: src, market: finished } as never);
    expect(bt.trades.map((t) => [t.entryTime, t.exitTime])).toEqual(chartRun.trades.map((t) => [t.entryTime, t.exitTime]));
    expect(chartRun.trades.length).toBeGreaterThan(0);
  });
});
