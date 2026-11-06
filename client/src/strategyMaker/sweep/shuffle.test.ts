import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { synth } from '../engine/synthetic';
import { seedOf, shuffledCopy } from './shuffle';

const bars = synth(300, 5).map((c, i) => ({ ...c, volume: 100 + i }));
const tuples = (cs: Candle[]): string[] =>
  cs
    .slice(1)
    .map((c, i) => [c.open / cs[i].close, c.high / c.open, c.low / c.open, c.close / c.open].map((v) => v.toFixed(9)).join('|'))
    .sort();

describe('seedOf', () => {
  it('is the same for the same text and differs for another', () => {
    expect(seedOf('binance|BTCUSDT|1d')).toBe(seedOf('binance|BTCUSDT|1d'));
    expect(seedOf('binance|BTCUSDT|1d')).not.toBe(seedOf('binance|BTCUSDT|1w'));
    expect(Number.isInteger(seedOf('x'))).toBe(true);
  });
});

describe('shuffledCopy', () => {
  it('gives the same copy for the same seed and another for another seed', () => {
    expect(shuffledCopy(bars, 1)).toEqual(shuffledCopy(bars, 1));
    expect(shuffledCopy(bars, 1)).not.toEqual(shuffledCopy(bars, 2));
  });

  it('keeps the multiset of moves and of volumes, but changes their order', () => {
    const copy = shuffledCopy(bars, 3);
    expect(tuples(copy)).toEqual(tuples(bars));
    expect(copy.map((c) => c.volume).sort((a, b) => a - b)).toEqual(bars.map((c) => c.volume).sort((a, b) => a - b));
    expect(copy.map((c) => c.close)).not.toEqual(bars.map((c) => c.close));
  });

  it('moves each volume with its own move', () => {
    const move = (cs: Candle[], i: number): string => (cs[i].close / cs[i].open).toFixed(9);
    const byVolume = new Map(bars.slice(1).map((c, i) => [c.volume, move(bars, i + 1)]));
    const copy = shuffledCopy(bars, 9);
    copy.slice(1).forEach((c, i) => expect(move(copy, i + 1)).toBe(byVolume.get(c.volume)));
  });

  it('keeps the times and the first bar', () => {
    const copy = shuffledCopy(bars, 4);
    expect(copy).toHaveLength(bars.length);
    expect(copy.map((c) => c.time)).toEqual(bars.map((c) => c.time));
    expect(copy[0]).toEqual(bars[0]);
  });

  it('keeps every bar well formed', () => {
    for (const c of shuffledCopy(bars, 6)) {
      expect(c.high).toBeGreaterThanOrEqual(Math.max(c.open, c.close));
      expect(c.low).toBeLessThanOrEqual(Math.min(c.open, c.close));
    }
  });

  it('gives back a series of fewer than 3 bars as it was', () => {
    expect(shuffledCopy(bars.slice(0, 2), 1)).toEqual(bars.slice(0, 2));
    expect(shuffledCopy([], 1)).toEqual([]);
  });
});
