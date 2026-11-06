import { describe, expect, it } from 'vitest';
import { gridSize, MAX_GRID_COMBOS } from '../../lib/backtest/optimizer';
import { candidatesOf, DEFAULT_SPACE, validParams } from './search';
import { validationBacktests } from './validate';

describe('composed in the strategy maker search', () => {
  it('has a default space of at most 400 raw combinations', () => {
    expect(gridSize({ sweeps: DEFAULT_SPACE.composed })).toBeLessThanOrEqual(400);
  });

  it('yields only valid settings, with no duplicates', () => {
    const all = [...candidatesOf('composed', DEFAULT_SPACE.composed, 1)];
    expect(all.length).toBeGreaterThan(0);
    for (const c of all) expect(validParams('composed', c.params)).toBe(true);
    expect(new Set(all.map((c) => JSON.stringify(c.params))).size).toBe(all.length);
    // fast is always below slow, and a disabled filter keeps its default settings
    for (const c of all) {
      expect(c.params.fast).toBeLessThan(c.params.slow);
      if (c.params.trendFilter === 0) expect(c.params.trendLen).toBe(100);
      if (c.params.adxFilter === 0) expect(c.params.adxMin).toBe(20);
    }
  });

  it('rejects wrong orderings and settings that do nothing', () => {
    const d = {
      entryRule: 2,
      direction: 1,
      fast: 12,
      slow: 26,
      signal: 9,
      length: 20,
      oversold: 30,
      overbought: 70,
      mult: 2,
      mode: 0,
      entry: 20,
      exit: 10,
      trendFilter: 0,
      trendLen: 100,
      volumeFilter: 0,
      volumeLen: 20,
      volumeMult: 1,
      atrFilter: 0,
      atrLen: 14,
      atrMinPct: 0.5,
      atrMaxPct: 5,
      adxFilter: 0,
      adxLen: 14,
      adxMin: 20,
    };
    expect(validParams('composed', d)).toBe(true);
    expect(validParams('composed', { ...d, fast: 30 })).toBe(false);
    expect(validParams('composed', { ...d, trendLen: 50 })).toBe(false);
    expect(validParams('composed', { ...d, trendFilter: 1, trendLen: 50 })).toBe(true);
    expect(validParams('composed', { ...d, adxMin: 30 })).toBe(false);
    expect(validParams('composed', { ...d, entry: 25 })).toBe(false);
    expect(validParams('composed', { ...d, entryRule: 4, oversold: 80 })).toBe(false);
    expect(validParams('composed', { ...d, entryRule: 4, fast: 99 })).toBe(false);
  });

  it('a search over all families with 4 series stays under the grid cap', () => {
    const maxKeys = Math.max(...Object.values(DEFAULT_SPACE).map((s) => s.length));
    const candidates = Object.values(DEFAULT_SPACE).reduce((a, sweeps) => a + gridSize({ sweeps }), 0);
    const S = 4;
    expect(candidates * S + 8 * S * 2 + validationBacktests(S, maxKeys)).toBeLessThan(MAX_GRID_COMBOS);
  });
});
