import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { candlesFromCsvText } from '../csv';
import { setDefaultMarketFeed } from '../pine/marketFeed';
import { START, candles15, fakeServer, hourlyOf } from '../pine/securityFixture';
import type { PineMarket } from '../pine/types';
import { defaultOptimizeConfig, runOptimizeAsync } from './optimizer';
import { runPineBacktest } from './pine';
import { defaultBacktestConfig, type BacktestConfig } from './types';
import { DEFAULT_WALK_FORWARD } from './walkForward';
import { runValidatedOptimize } from './validation';

const candles = candlesFromCsvText(readFileSync(fileURLToPath(new URL('../../../../examples/sample-daily.csv', import.meta.url)), 'utf8')).candles;

const sourceStrategy = `//@version=6
strategy("Source", overlay=true, default_qty_type=strategy.fixed, default_qty_value=1)
len = input.int(10, "Len")
src = input.source(close, "Src")
avg = ta.sma(src, len)
if ta.crossover(src, avg)
    strategy.entry("L", strategy.long)
if ta.crossunder(src, avg)
    strategy.close("L")`;

const cfg = (pineCode: string, patch: Partial<BacktestConfig> = {}): BacktestConfig => ({
  ...defaultBacktestConfig(),
  strategyId: 'pine',
  params: {},
  pineCode,
  feeBps: 0,
  ...patch,
});
const shape = (r: Awaited<ReturnType<typeof runPineBacktest>>) => r.trades.map((t) => [t.side, t.entryTime, t.entryPrice, t.exitTime, t.exitPrice]);
const sweep = { sweeps: [{ key: 'Len', from: 5, to: 15, step: 5 }], metric: 'totalReturnPct' as const };

describe('Pine text inputs in a backtest', () => {
  it('pineInputs change the trades, and params win over a pineInputs entry of the same name', async () => {
    const plain = await runPineBacktest(candles, cfg(sourceStrategy));
    const onOpen = await runPineBacktest(candles, cfg(sourceStrategy, { pineInputs: { Src: 'open' } }));
    expect(plain.trades.length).toBeGreaterThan(0);
    expect(shape(onOpen)).not.toEqual(shape(plain));
    const mixed = await runPineBacktest(candles, cfg(sourceStrategy, { pineInputs: { Src: 'open', Len: '99' }, params: { Len: 10 } }));
    expect(shape(mixed)).toEqual(shape(onOpen));
  });

  it('every optimizer combination uses the pineInputs, as a direct run does', async () => {
    const base = cfg(sourceStrategy, { pineInputs: { Src: 'open' } });
    const out = await runOptimizeAsync(candles, base, { ...defaultOptimizeConfig(base), ...sweep });
    expect(out.errored).toBe(0);
    expect(out.rows).toHaveLength(3);
    const ignoring = await runOptimizeAsync(candles, cfg(sourceStrategy), { ...defaultOptimizeConfig(base), ...sweep });
    for (const row of out.rows) {
      const direct = await runPineBacktest(candles, { ...base, params: { Len: row.params.Len } });
      expect(row.metrics).toEqual(direct.metrics);
    }
    expect(out.rows.map((r) => r.metrics)).not.toEqual(ignoring.rows.map((r) => r.metrics));
  });

  it('the walk-forward and held-out reruns use the pineInputs', async () => {
    const run = (patch: Partial<BacktestConfig>, validation: object) => {
      const base = cfg(sourceStrategy, patch);
      return runValidatedOptimize(candles, base, { ...defaultOptimizeConfig(base), ...sweep, validation } as never);
    };
    const wf = { ...DEFAULT_WALK_FORWARD, windows: 3 };
    const [withOpen, plain] = [await run({ pineInputs: { Src: 'open' } }, wf), await run({}, wf)];
    expect(withOpen.errored).toBe(0);
    expect(withOpen.walkForward).toBeDefined();
    expect(JSON.stringify(withOpen.walkForward)).not.toBe(JSON.stringify(plain.walkForward));
    const split = { method: 'split', inSamplePct: 70, topN: 3 };
    const [s1, s2] = [await run({ pineInputs: { Src: 'open' } }, split), await run({}, split)];
    expect(JSON.stringify(s1.validation)).not.toBe(JSON.stringify(s2.validation));
  });
});

describe('a timeframe input through request.security', () => {
  const tfStrategy = `//@version=6
strategy("Higher", overlay=true, default_qty_type=strategy.fixed, default_qty_value=1)
tf = input.timeframe("D", "TF")
d = request.security(syminfo.tickerid, tf, ta.sma(close, 3))
if ta.crossover(close, d)
    strategy.entry("L", strategy.long)
if ta.crossunder(close, d)
    strategy.close("L")`;
  const market: PineMarket = { providerId: 'binance', symbol: 'BTCUSDT', interval: '1h' };
  const base = candles15(96 * 60);
  const chart = hourlyOf(base);
  afterEach(() => setDefaultMarketFeed(null));

  it('a different timeframe gives different trades, in a backtest and in each combination', async () => {
    void START;
    setDefaultMarketFeed(fakeServer(base).feed);
    const c = (pineInputs?: Record<string, string>) => cfg(tfStrategy, { market, ...(pineInputs && { pineInputs }) });
    const daily = await runPineBacktest(chart, c());
    const fourH = await runPineBacktest(chart, c({ TF: '240' }));
    expect(daily.trades.length).toBeGreaterThan(0);
    expect(shape(fourH)).not.toEqual(shape(daily));
    const out = await runOptimizeAsync(chart, c({ TF: '240' }), { ...defaultOptimizeConfig(c()), sweeps: [{ key: 'unused', from: 1, to: 1, step: 1 }], metric: 'totalReturnPct' });
    expect(out.rows.every((r) => r.metrics.trades === fourH.trades.length)).toBe(true);
  });
});
