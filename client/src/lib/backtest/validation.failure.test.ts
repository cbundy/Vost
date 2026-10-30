import { describe, expect, it, vi } from 'vitest';
import type { Candle } from '../../types';
import { defaultBacktestConfig } from './types';

// A held-out run that throws: the fake runs the real backtest except on the 90-bar held-out slice,
// where it throws for the second param value only.
vi.mock('./runner', async (orig) => {
  const real = await orig<typeof import('./runner')>();
  return {
    ...real,
    runAnyBacktest: async (c: Candle[], cfg: Parameters<typeof real.runAnyBacktest>[1], p?: Parameters<typeof real.runAnyBacktest>[2]) => {
      if (c.length === 90 && cfg.params.fast === 6) throw new Error('held-out boom');
      return real.runAnyBacktest(c, cfg, p);
    },
  };
});

import { runValidatedOptimize } from './validation';

describe('a held-out run that throws', () => {
  it('is kept with null metrics, counted as failed and left unranked', async () => {
    const candles: Candle[] = Array.from({ length: 300 }, (_, i) => {
      const c = 100 + 20 * Math.sin(i / 9) + 8 * Math.sin(i / 3.1) + i * 0.05;
      return { time: 1_600_000_000 + i * 86400, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 };
    });
    const out = await runValidatedOptimize(candles, defaultBacktestConfig(), {
      sweeps: [{ key: 'fast', from: 5, to: 8, step: 1 }],
      metric: 'totalReturnPct',
      validation: { method: 'split', inSamplePct: 70, topN: 10 },
    });
    const v = out.validation!;
    expect(v.checks).toHaveLength(4);
    expect(v.failed).toBe(1);
    const bad = v.checks.find((c) => c.params.fast === 6)!;
    expect(bad.heldOut).toBeNull();
    expect(bad.heldOutValue).toBeNull();
    expect(bad.heldOutRank).toBeNull();
    const ranks = v.checks.filter((c) => c !== bad).map((c) => c.heldOutRank);
    expect([...ranks].sort()).toEqual([1, 2, 3]);
  });
});
