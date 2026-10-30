import { afterEach, describe, expect, it } from 'vitest';
import { setDefaultMarketFeed } from '../pine/marketFeed';
import { START, candles15, fakeServer, hourlyOf } from '../pine/securityFixture';
import type { PineMarket } from '../pine/types';
import { defaultOptimizeConfig, runOptimizeAsync } from './optimizer';
import { runPineBacktest } from './pine';
import { runAnyBacktest } from './runner';
import { defaultBacktestConfig, type BacktestConfig } from './types';
import { DEFAULT_WALK_FORWARD } from './walkForward';
import { runValidatedOptimize } from './validation';

const src = `//@version=6
strategy("Daily cross", overlay=true, default_qty_type=strategy.fixed, default_qty_value=1)
len = input.int(3, "Len")
d = request.security(syminfo.tickerid, "D", ta.sma(close, len))
if ta.crossover(close, d)
    strategy.entry("L", strategy.long)
if ta.crossunder(close, d)
    strategy.close("L")`;
const market: PineMarket = { providerId: 'binance', symbol: 'BTCUSDT', interval: '1h' };
const cfg = (patch: Partial<BacktestConfig> = {}): BacktestConfig => ({ ...defaultBacktestConfig(), strategyId: 'pine', params: { Len: 3 }, pineCode: src, feeBps: 0, market, ...patch });

const base = candles15(96 * 60);
const chart = hourlyOf(base);
const shape = (r: Awaited<ReturnType<typeof runPineBacktest>>) => r.trades.map((t) => [t.side, t.entryTime, t.entryPrice, t.exitTime, t.exitPrice]);

afterEach(() => setDefaultMarketFeed(null));

describe('a strategy on a daily value of the same symbol', () => {
  it('makes the same trades in a backtest, an optimizer combination and a window of the data', async () => {
    const server = fakeServer(base);
    setDefaultMarketFeed(server.feed);
    const full = await runPineBacktest(chart, cfg());
    expect(full.trades.length).toBeGreaterThan(3);

    // Every grid combination is a separate run; the one with Len 3 is the backtest, and the whole grid makes one fetch.
    const out = await runOptimizeAsync(chart, cfg(), { ...defaultOptimizeConfig(cfg()), sweeps: [{ key: 'Len', from: 2, to: 21, step: 1 }], metric: 'totalReturnPct' });
    expect(out.errored).toBe(0);
    expect(out.rows).toHaveLength(20);
    expect(server.calls).toHaveLength(1);
    const row = out.rows.find((r) => r.params.Len === 3)!;
    expect(row.metrics).toEqual(full.metrics);
    expect(shape(await runAnyBacktest(chart, cfg({ params: { Len: 3 } })))).toEqual(shape(full));

    // A window of the data (what a walk-forward slice runs) trades the same once the daily average is warm.
    const from = 24 * 20;
    const win = await runPineBacktest(chart.slice(from), cfg());
    const warm = chart[from + 24 * 5].time;
    expect(shape(win).filter((t) => (t[1] as number) >= warm)).toEqual(shape(full).filter((t) => (t[1] as number) >= warm));
    expect(shape(win).filter((t) => (t[1] as number) >= warm).length).toBeGreaterThan(0);
  });

  it('runs walk-forward windows on it', async () => {
    setDefaultMarketFeed(fakeServer(base).feed);
    const c = cfg();
    const out = await runValidatedOptimize(chart, c, {
      ...defaultOptimizeConfig(c), sweeps: [{ key: 'Len', from: 2, to: 4, step: 1 }], metric: 'totalReturnPct',
      validation: { ...DEFAULT_WALK_FORWARD, windows: 3 },
    });
    expect(out.errored).toBe(0);
    expect(out.walkForward?.failed).toBe(0);
    expect(out.walkForward?.results.length).toBe(3);
  });

  it('a later run with later candles fetches only the newer daily bars', async () => {
    const server = fakeServer(base);
    setDefaultMarketFeed(server.feed);
    await runPineBacktest(chart.slice(0, 24 * 30), cfg());
    expect(server.calls).toHaveLength(1);
    await runPineBacktest(chart.slice(0, 24 * 40), cfg());
    expect(server.calls).toHaveLength(2);
    expect(server.calls[1].from).toBe(START + 30 * 86400);
  });
});

describe('a strategy trading the spread to another symbol', () => {
  const spread = `//@version=6
strategy("Spread", overlay=true, default_qty_type=strategy.fixed, default_qty_value=1)
len = input.int(5, "Len")
other = request.security("BYBIT:BTCUSDT", "", close)
d = close - other
if ta.crossover(d, ta.sma(d, len))
    strategy.entry("L", strategy.long)
if ta.crossunder(d, ta.sma(d, len))
    strategy.close("L")`;
  const bybit = candles15(96 * 60, 7, 100);
  const markets = { 'binance|BTCUSDT': base, 'bybit|BTCUSDT': bybit };
  const scfg = (patch: Partial<BacktestConfig> = {}): BacktestConfig => ({ ...cfg(patch), pineCode: spread, params: { Len: 5 } });

  it('makes the same trades in a backtest, an optimizer combination and the any-strategy runner, from Bybit data', async () => {
    const server = fakeServer(base, { markets });
    setDefaultMarketFeed(server.feed);
    const full = await runPineBacktest(chart, scfg());
    expect(full.trades.length).toBeGreaterThan(3);
    const out = await runOptimizeAsync(chart, scfg(), { ...defaultOptimizeConfig(scfg()), sweeps: [{ key: 'Len', from: 3, to: 8, step: 1 }], metric: 'totalReturnPct' });
    expect(out.errored).toBe(0);
    expect(out.rows).toHaveLength(6);
    expect(out.rows.find((r) => r.params.Len === 5)!.metrics).toEqual(full.metrics);
    expect(shape(await runAnyBacktest(chart, scfg()))).toEqual(shape(full));
    // Only Bybit was asked for, once for the whole grid.
    expect(new Set(server.calls.map((c) => c.providerId))).toEqual(new Set(['bybit']));
    expect(server.calls).toHaveLength(1);

    // The same script on the chart's own close gives other trades: the other symbol really is the one traded against.
    const ownServer = fakeServer(base, { markets: { 'binance|BTCUSDT': base, 'bybit|BTCUSDT': base } });
    setDefaultMarketFeed(ownServer.feed);
    expect(shape(await runPineBacktest(chart, scfg()))).not.toEqual(shape(full));
  });
});
