import { describe, expect, it, vi } from 'vitest';
import type { Candle } from '../../types';
import { defaultBacktestConfig } from './types';
import type { RobustnessOutput } from './validation';

// Counts every backtest the optimizer makes (both entry points), running the real one.
const calls = vi.hoisted(() => ({ n: 0, lengths: new Set<number>() }));
vi.mock('./runner', async (orig) => {
  const real = await orig<typeof import('./runner')>();
  return {
    ...real,
    runFullBacktest: (c: Candle[], cfg: Parameters<typeof real.runFullBacktest>[1]) => {
      calls.n++;
      calls.lengths.add(c.length);
      return real.runFullBacktest(c, cfg);
    },
    runAnyBacktest: async (c: Candle[], cfg: Parameters<typeof real.runAnyBacktest>[1], p?: Parameters<typeof real.runAnyBacktest>[2]) => {
      calls.n++;
      calls.lengths.add(c.length);
      return real.runAnyBacktest(c, cfg, p);
    },
  };
});

import { gridSize } from './optimizer';
import { robustnessScores } from './robustness';
import { runValidatedOptimize } from './validation';

const candles: Candle[] = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 20 * Math.sin(i / 9) + 8 * Math.sin(i / 3.1) + i * 0.05;
  return { time: 1_600_000_000 + i * 86400, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 };
});

describe('runValidatedOptimize with robustness', () => {
  const o = {
    sweeps: [{ key: 'fast', from: 5, to: 9, step: 1 }, { key: 'slow', from: 20, to: 40, step: 5 }],
    metric: 'totalReturnPct' as const,
    validation: { method: 'robustness' as const, radius: 1, rankByScore: true },
  };

  it('runs exactly one backtest per combination on the whole range and scores every row', async () => {
    calls.n = 0;
    calls.lengths.clear();
    const seen: number[] = [];
    const out = await runValidatedOptimize(candles, defaultBacktestConfig(), o, (p) => seen.push(p));
    expect(calls.n).toBe(gridSize(o));
    expect([...calls.lengths]).toEqual([300]);
    const v = out.validation as RobustnessOutput;
    expect(v).toMatchObject({ method: 'robustness', radius: 1, rankByScore: true });
    expect(v.scores).toHaveLength(out.rows.length);
    expect(v.scores).toEqual(robustnessScores(out.rows, o.sweeps, 1));
    expect(v.scores.some((s) => s.neighbourCount > 0)).toBe(true);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen[seen.length - 1]).toBe(1);
  });

  it('refuses a bad neighbourhood before running anything', async () => {
    calls.n = 0;
    await expect(runValidatedOptimize(candles, defaultBacktestConfig(), { ...o, validation: { method: 'robustness', radius: 4, rankByScore: false } })).rejects.toThrow(
      /Neighbourhood must be a whole number from 1 to 3\./,
    );
    expect(calls.n).toBe(0);
  });
});
