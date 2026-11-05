import { describe, expect, it } from 'vitest';
import {
  applyStroke,
  barCount,
  commit,
  emptyHistory,
  erase,
  paint,
  redo,
  strokeTrade,
  undo,
  type HighlightTrade,
} from './brush';

const times = Array.from({ length: 20 }, (_, i) => 1000 + i * 60);
const T = (a: number, b: number, side: 'long' | 'short' = 'long'): HighlightTrade => ({ side, entryTime: times[a], exitTime: times[b] });

describe('strokeTrade', () => {
  it('gives the same trade left to right and right to left', () => {
    expect(strokeTrade(times, 3, 8, 'long')).toEqual(T(3, 8));
    expect(strokeTrade(times, 8, 3, 'long')).toEqual(T(3, 8));
  });
  it('snaps to bar times and clamps to the bars', () => {
    expect(strokeTrade(times, -5, 2, 'short')).toEqual(T(0, 2, 'short'));
    expect(strokeTrade(times, 18, 99, 'long')).toEqual(T(18, 19));
  });
  it('gives nothing for a one-bar click', () => {
    expect(strokeTrade(times, 4, 4, 'long')).toBeNull();
    expect(strokeTrade([], 0, 3, 'long')).toBeNull();
  });
});

describe('paint', () => {
  it('replaces the overlapped part and keeps no overlap', () => {
    const out = paint([T(2, 10)], times, T(6, 14, 'short'));
    expect(out).toEqual([T(2, 5), T(6, 14, 'short')]);
  });
  it('splits a trade cut in the middle and keeps both remainders', () => {
    expect(paint([T(0, 15)], times, T(6, 8, 'short'))).toEqual([T(0, 5), T(6, 8, 'short'), T(9, 15)]);
  });
  it('drops a remainder under two bars', () => {
    expect(paint([T(2, 10)], times, T(3, 12, 'short'))).toEqual([T(3, 12, 'short')]);
  });
  it('swallows trades it covers fully', () => {
    expect(paint([T(2, 4), T(6, 8)], times, T(1, 9, 'short'))).toEqual([T(1, 9, 'short')]);
  });
  it('keeps trades apart from the stroke', () => {
    expect(paint([T(0, 2)], times, T(5, 7))).toEqual([T(0, 2), T(5, 7)]);
  });
  it('never leaves overlapping trades over many strokes', () => {
    let trades: readonly HighlightTrade[] = [];
    for (let i = 0; i < 40; i++) {
      trades = applyStroke(trades, times, { kind: 'brush', side: i % 2 ? 'long' : 'short' }, (i * 7) % 20, (i * 11 + 3) % 20);
    }
    for (let i = 1; i < trades.length; i++) expect(trades[i].entryTime).toBeGreaterThan(trades[i - 1].exitTime);
  });
});

describe('erase', () => {
  it('removes every trade the stroke touches', () => {
    expect(erase([T(0, 3), T(5, 8), T(12, 15)], times, 8, 12)).toEqual([T(0, 3)]);
  });
  it('keeps trades it does not touch and reports no change by identity', () => {
    const trades = [T(0, 3)];
    expect(applyStroke(trades, times, { kind: 'eraser' }, 6, 9)).toBe(trades);
  });
});

describe('history', () => {
  it('undoes and redoes exact states', () => {
    const a = [T(1, 3)];
    const b = paint(a, times, T(5, 7));
    let h = commit(commit(emptyHistory(), a), b);
    h = undo(h);
    expect(h.present).toBe(a);
    h = undo(h);
    expect(h.present).toEqual([]);
    expect(undo(h)).toBe(h);
    h = redo(redo(h));
    expect(h.present).toBe(b);
    expect(redo(h)).toBe(h);
  });
  it('clears redo on a new stroke and ignores a no-op', () => {
    let h = commit(emptyHistory(), [T(1, 3)]);
    h = undo(h);
    expect(h.future).toHaveLength(1);
    h = commit(h, [T(4, 6)]);
    expect(h.future).toHaveLength(0);
    expect(commit(h, h.present)).toBe(h);
  });
});

describe('times, not bar indexes', () => {
  it('counts the bars of a trade on a different slice of the same series', () => {
    const trade = T(5, 9);
    expect(barCount(times, trade)).toBe(5);
    expect(barCount(times.slice(3, 12), trade)).toBe(5);
    expect(barCount(times.slice(6, 12), trade)).toBe(4);
  });
  it('paints on a slice without disturbing trades outside it', () => {
    const slice = times.slice(8, 16);
    expect(paint([T(0, 3)], slice, T(9, 12))).toEqual([T(0, 3), T(9, 12)]);
  });
});
