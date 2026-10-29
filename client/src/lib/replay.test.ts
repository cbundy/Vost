import { describe, expect, it } from 'vitest';
import type { Candle } from '../types';
import {
  REPLAY_SPEEDS,
  replayAtEnd,
  replayAtStart,
  replayIntervalMs,
  replayStartIndex,
  replayVisible,
  runFitsVisible,
  runIsPrefixOf,
  stepReplay,
} from './replay';

const bars = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ time: 1000 + i * 60, open: 1, high: 2, low: 0.5, close: 1.5, volume: 1 }));

describe('replayStartIndex', () => {
  const src = bars(10);
  it('takes the bar a time falls on', () => {
    expect(replayStartIndex(src, src[5].time)).toBe(5);
  });
  it('takes the last bar at or before a time between bars', () => {
    expect(replayStartIndex(src, src[5].time + 30)).toBe(5);
  });
  it('refuses a time before the first or after the last bar', () => {
    expect(replayStartIndex(src, src[0].time - 1)).toBeNull();
    expect(replayStartIndex(src, src[9].time + 1)).toBeNull();
    expect(replayStartIndex(src, Number.NaN)).toBeNull();
  });
  it('keeps at least 2 bars visible and 1 left to replay', () => {
    expect(replayStartIndex(src, src[0].time)).toBe(1);
    expect(replayStartIndex(src, src[9].time)).toBe(8);
  });
  it('refuses data too short to replay', () => {
    expect(replayStartIndex(bars(2), 1000)).toBeNull();
    expect(replayStartIndex(bars(3), 1000)).toBe(1);
  });
});

describe('stepReplay', () => {
  const src = bars(6);
  it('moves and clamps at both bounds', () => {
    expect(stepReplay({ source: src, cursor: 3 }, 1)).toBe(4);
    expect(stepReplay({ source: src, cursor: 3 }, -1)).toBe(2);
    expect(stepReplay({ source: src, cursor: 5 }, 1)).toBe(5);
    expect(stepReplay({ source: src, cursor: 1 }, -1)).toBe(1);
  });
  it('reports the bounds', () => {
    expect(replayAtEnd({ source: src, cursor: 5 })).toBe(true);
    expect(replayAtEnd({ source: src, cursor: 4 })).toBe(false);
    expect(replayAtStart({ source: src, cursor: 1 })).toBe(true);
    expect(replayAtStart({ source: src, cursor: 2 })).toBe(false);
  });
  it('slices the visible bars', () => {
    expect(replayVisible(src, 2)).toEqual(src.slice(0, 3));
  });
});

describe('replayIntervalMs', () => {
  it('is 1000 / speed', () => {
    expect(REPLAY_SPEEDS.map(replayIntervalMs)).toEqual([1000, 1000 / 3, 100]);
  });
});

describe('runFitsVisible', () => {
  const run = bars(5);
  it('accepts an equal or shorter run and rejects a longer one', () => {
    expect(runFitsVisible(run, run[4].time)).toBe(true);
    expect(runFitsVisible(run, run[4].time + 60)).toBe(true);
    expect(runFitsVisible(run, run[3].time)).toBe(false);
  });
  it('accepts when there is no replay or no run', () => {
    expect(runFitsVisible(run, null)).toBe(true);
    expect(runFitsVisible(undefined, 5)).toBe(true);
  });
});

describe('runIsPrefixOf', () => {
  const cur = bars(10);
  it('is true for a strict prefix and for equal arrays', () => {
    expect(runIsPrefixOf(cur.slice(0, 5), cur)).toBe(true);
    expect(runIsPrefixOf(cur, cur.slice())).toBe(true);
  });
  it('is false for a longer run or an empty run', () => {
    expect(runIsPrefixOf(cur, cur.slice(0, 5))).toBe(false);
    expect(runIsPrefixOf([], cur)).toBe(false);
  });
  it('is false for a different first bar or a different bar at the last index', () => {
    expect(runIsPrefixOf(cur.slice(1, 5), cur)).toBe(false);
    expect(runIsPrefixOf([cur[0], cur[1], { ...cur[2], time: cur[2].time + 1 }], cur)).toBe(false);
  });
});
