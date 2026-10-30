import { describe, expect, it } from 'vitest';
import { addAll, inBox, normalizeRect, only, prune, toggle } from './drawingSelection';

describe('selection list', () => {
  it('toggle adds at the end and removes, keeping order', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggle(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
    expect(toggle([], 'a')).toEqual(['a']);
  });
  it('only and addAll', () => {
    expect(only('x')).toEqual(['x']);
    expect(addAll(['a', 'b'], ['b', 'c', 'd'])).toEqual(['a', 'b', 'c', 'd']);
  });
  it('prune drops ids that are gone and keeps the same list when none is', () => {
    const sel = ['a', 'b', 'c'];
    expect(prune(sel, [{ id: 'a' }, { id: 'c' }])).toEqual(['a', 'c']);
    expect(prune(sel, [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])).toBe(sel);
  });
});

describe('box', () => {
  const rect = normalizeRect({ x: 10, y: 10 }, { x: 100, y: 100 });
  it('normalizes a box drawn in each of the four directions', () => {
    const want = { left: 10, top: 10, right: 100, bottom: 100 };
    expect(normalizeRect({ x: 10, y: 10 }, { x: 100, y: 100 })).toEqual(want);
    expect(normalizeRect({ x: 100, y: 10 }, { x: 10, y: 100 })).toEqual(want);
    expect(normalizeRect({ x: 10, y: 100 }, { x: 100, y: 10 })).toEqual(want);
    expect(normalizeRect({ x: 100, y: 100 }, { x: 10, y: 10 })).toEqual(want);
  });
  it('inBox needs every point inside', () => {
    expect(inBox([{ x: 20, y: 20 }, { x: 90, y: 90 }], rect)).toBe(true);
    expect(inBox([{ x: 20, y: 20 }, { x: 120, y: 90 }], rect)).toBe(false);
    expect(inBox([], rect)).toBe(false);
  });
  it('ignoreX and ignoreY skip an axis', () => {
    const far = [{ x: 500, y: 50 }];
    expect(inBox(far, rect)).toBe(false);
    expect(inBox(far, rect, { ignoreX: true })).toBe(true);
    expect(inBox(far, rect, { ignoreY: true })).toBe(false);
    expect(inBox([{ x: 50, y: 500 }], rect, { ignoreY: true })).toBe(true);
    expect(inBox([{ x: 500, y: 500 }], rect, { ignoreX: true, ignoreY: true })).toBe(true);
  });
});
