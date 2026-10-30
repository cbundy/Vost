import { describe, expect, it, vi } from 'vitest';
import type { Candle } from '../../types';
import { defaultBacktestConfig } from './types';

// Throws on the second window's held-out slice only: 300 bars, 3 windows at 70% -> held-out blocks of 56 bars
// starting at bar 132; the second one starts at bar 188. In-sample slices are 132 bars, so they never match.
const START = 1_600_000_000 + 188 * 86400;
vi.mock('./runner', async (orig) => {
  const real = await orig<typeof import('./runner')>();
  return {
    ...real,
    runAnyBacktest: async (c: Candle[], cfg: Parameters<typeof real.runAnyBacktest>[1], p?: Parameters<typeof real.runAnyBacktest>[2]) => {
      if (c.length === 56 && c[0].time === START) throw new Error('held-out boom');
      return real.runAnyBacktest(c, cfg, p);
    },
  };
});

import { runWalkForward } from './walkForward';

describe('a walk-forward held-out run that throws', () => {
  it('marks the window failed and leaves the combined result out', async () => {
    const candles: Candle[] = Array.from({ length: 300 }, (_, i) => {
      const c = 100 + 20 * Math.sin(i / 9) + 8 * Math.sin(i / 3.1) + i * 0.05;
      return { time: 1_600_000_000 + i * 86400, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 };
    });
    const cfg = { method: 'walk-forward', windows: 3, inSamplePct: 70, anchored: false } as const;
    const { walkForward: w } = await runWalkForward(candles, defaultBacktestConfig(), { sweeps: [{ key: 'fast', from: 5, to: 8, step: 1 }], metric: 'totalReturnPct', validation: cfg }, cfg);
    expect(w.results.map((r) => r.status)).toEqual(['ok', 'failed', 'ok']);
    expect(w.results[1].heldOutMetrics).toBeNull();
    expect(w.results[1].params).not.toBeNull();
    expect(w.failed).toBe(1);
    expect(w.incomplete).toBe(1);
    expect(w.combined).toBeNull();
    expect(w.equity).toEqual([]);
  });
});
