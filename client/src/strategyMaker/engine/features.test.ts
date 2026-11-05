import { describe, expect, it } from 'vitest';
import { getStrategy } from '../../lib/backtest/strategies';
import { FEATURES, featureColumn, formatValue, isKnownFeature } from './features';
import { synth } from './synthetic';
import { SIGNAL_FAMILIES } from './types';

describe('features', () => {
  it('are generated from family grids: under 100, every family covered, no duplicates', () => {
    expect(FEATURES.length).toBeLessThan(100);
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
    expect(new Set(FEATURES.map((f) => f.label)).size).toBe(FEATURES.length);
    for (const family of SIGNAL_FAMILIES) expect(FEATURES.some((f) => f.family === family)).toBe(true);
    expect(FEATURES.some((f) => f.family === null)).toBe(true);
  });

  it('record params that are valid keys of the family settings, with fast below slow', () => {
    for (const f of FEATURES) {
      if (f.family == null) {
        expect(f.params).toEqual({});
        continue;
      }
      const keys = getStrategy(f.family).params.map((p) => p.key);
      for (const k of Object.keys(f.params)) expect(keys).toContain(k);
      expect(Object.keys(f.params)).not.toContain('direction');
      if (f.params.fast != null) expect(f.params.fast).toBeLessThan(f.params.slow);
    }
  });

  it('are undefined during warm-up and defined after, without looking ahead', () => {
    const candles = synth(400, 5);
    const id = 'sma_cross_8_34';
    const col = featureColumn(id, candles);
    expect(col.slice(0, 33).every(Number.isNaN)).toBe(true);
    expect(Number.isNaN(col[33])).toBe(false);
    const shorter = featureColumn(id, candles.slice(0, 200));
    expect(Array.from(col.slice(0, 200))).toEqual(Array.from(shorter));
    const closes = candles.map((c) => c.close);
    const avg = (n: number, i: number): number => closes.slice(i - n + 1, i + 1).reduce((a, b) => a + b, 0) / n;
    expect(col[100]).toBeCloseTo(avg(8, 100) / avg(34, 100) - 1, 12);
  });

  it('knows its own features and nothing else', () => {
    expect(isKnownFeature(FEATURES[0])).toBe(true);
    expect(isKnownFeature({ ...FEATURES[0], id: 'nope' })).toBe(false);
    expect(isKnownFeature({ ...FEATURES[0], params: { fast: 1, slow: 2 } })).toBe(false);
    expect(() => featureColumn('nope', synth(50, 1))).toThrow();
  });

  it('shows ratios as percents', () => {
    expect(formatValue('sma_cross_8_34', 0.0003)).toBe('0.03%');
    expect(formatValue('rsi_reversion_14', 55.123)).toBe('55.12');
  });
});
