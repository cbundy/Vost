import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../random';
import type { Candle } from '../../types';
import { runAnyBacktest } from '../backtest/runner';
import type { BacktestConfig } from '../backtest/types';
import { createBacktestHandler, type WorkerRequest, type WorkerResponse } from './backtestHandler';

const rand = mulberry32(5);
let price = 100;
const candles: Candle[] = Array.from({ length: 400 }, (_, i) => {
  const open = price;
  price = Math.max(1, open * (1 + 0.04 * Math.sin(i / 9) + (rand() - 0.5) * 0.01));
  return { time: 1_600_000_000 + i * 3600, open, high: Math.max(open, price) * 1.002, low: Math.min(open, price) * 0.998, close: price, volume: 1000 };
});
const config: BacktestConfig = {
  strategyId: 'sma_cross',
  params: { fast: 5, slow: 20, direction: 1 },
  initialCapital: 10000,
  positionSizePct: 100,
  feeBps: 0,
  slippageBps: 0,
  allowShort: false,
  stopLossPct: null,
  takeProfitPct: null,
};

/** Runs one request and collects its replies up to the first one that is not progress. */
function call(req: WorkerRequest, opts?: Parameters<typeof createBacktestHandler>[1]): Promise<WorkerResponse[]> {
  return new Promise((resolve) => {
    const out: WorkerResponse[] = [];
    createBacktestHandler((m) => {
      out.push(m);
      if (m.type !== 'progress') resolve(out);
    }, opts)(req);
  });
}

describe('createBacktestHandler', () => {
  it('run: progress, then a result equal to a direct run', async () => {
    const out = await call({ id: 'a', type: 'run', candles, config });
    const last = out[out.length - 1];
    expect(out.every((m) => m.id === 'a')).toBe(true);
    expect(out.some((m) => m.type === 'progress')).toBe(true);
    expect(last.type).toBe('result');
    if (last.type === 'result') expect(last.result).toEqual(await runAnyBacktest(candles, config));
  });

  it('optimize: an optimizeResult with the swept keys', async () => {
    const out = await call({
      id: 'o',
      type: 'optimize',
      candles,
      config,
      optimize: { sweeps: [{ key: 'fast', from: 4, to: 6, step: 1 }], metric: 'sharpe', validation: { method: 'none' } },
    });
    const last = out[out.length - 1];
    expect(last.type).toBe('optimizeResult');
    if (last.type === 'optimizeResult') {
      expect(last.keys).toEqual(['fast']);
      expect(last.combos).toBe(3);
    }
  });

  it('montecarlo: a result, and a thrown error becomes an error reply', async () => {
    const bad = await call({ id: 'm', type: 'montecarlo', trades: [], initialCapital: 1000, options: { iterations: 100, method: 'shuffle', seed: 1 } });
    expect(bad).toEqual([{ id: 'm', type: 'error', message: expect.stringMatching(/at least/) }]);
    const run = await call({ id: 'r', type: 'run', candles, config });
    const result = run[run.length - 1];
    if (result.type !== 'result') throw new Error('no result');
    const trades = result.result.trades;
    expect(trades.length).toBeGreaterThan(2);
    const ok = await call({ id: 'm2', type: 'montecarlo', trades, initialCapital: 10000, options: { iterations: 100, method: 'shuffle', seed: 1 } });
    expect(ok[0].type).toBe('monteCarloResult');
  });

  it('a failing run gives an error reply', async () => {
    const out = await call({ id: 'e', type: 'run', candles, config: { ...config, strategyId: 'pine', pineCode: 'not pine at all (' } });
    expect(out[out.length - 1].type).toBe('error');
  });

  it('pine: runs a script', async () => {
    const out = await call({ id: 'p', type: 'pine', source: '//@version=6\nindicator("x")\nplot(close)\n', candles });
    expect(out[0].type).toBe('pineResult');
    if (out[0].type === 'pineResult') expect(out[0].outcome.ok).toBe(true);
  });

  it('pine: an injected resolver is used, and a miss gives the library outcome', async () => {
    const script = '//@version=6\nindicator("uses lib")\nimport bob/Inner/1 as inner\nplot(inner.double(close))\n';
    const lib = '//@version=6\nlibrary("Inner")\nexport double(float x) => x * 2\n';
    const asked: string[] = [];
    const hit = await call({ id: 'h', type: 'pine', source: script, candles }, { resolver: (p) => (asked.push(p), lib) });
    expect(asked).toContain('bob/Inner/1');
    expect(hit[0].type === 'pineResult' && hit[0].outcome.ok).toBe(true);
    const miss = await call({ id: 'x', type: 'pine', source: script, candles }, { resolver: () => null });
    const m = miss[0];
    expect(m.type).toBe('pineResult');
    if (m.type === 'pineResult' && !m.outcome.ok) expect(m.outcome.error.library).toBe('bob/Inner/1');
    else throw new Error('expected a library miss');
  });
});
