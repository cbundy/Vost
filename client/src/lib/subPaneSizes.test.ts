import { describe, expect, it } from 'vitest';
import { DEFAULT_SUB_FACTOR, paneFactors, recordFactors, type PaneFactors } from './subPaneSizes';

const live = (...ids: string[]) => new Set(ids);

describe('sub pane sizes', () => {
  it('new panes get the default', () => {
    expect(paneFactors(new Map(), ['a', 'b'])).toEqual([DEFAULT_SUB_FACTOR, DEFAULT_SUB_FACTOR]);
  });

  it('a kept factor survives a rebuild with a pane added before it, removed, or reordered', () => {
    const kept = recordFactors(new Map(), [{ id: 'a', factor: 0.9 }, { id: 'b', factor: 0.5 }], live('a', 'b', 'c'));
    expect(paneFactors(kept, ['c', 'a', 'b'])).toEqual([DEFAULT_SUB_FACTOR, 0.9, 0.5]);
    expect(paneFactors(kept, ['b'])).toEqual([0.5]);
    expect(paneFactors(kept, ['b', 'a'])).toEqual([0.5, 0.9]);
  });

  it('keeps a factor of a pane that is momentarily not built while its indicator lives', () => {
    const first = recordFactors(new Map(), [{ id: 'a', factor: 0.9 }], live('a'));
    const second = recordFactors(first, [], live('a'));
    expect(paneFactors(second, ['a'])).toEqual([0.9]);
  });

  it('drops ids that vanish', () => {
    const kept: PaneFactors = new Map([['gone', 2]]);
    const next = recordFactors(kept, [{ id: 'a', factor: 0.7 }, { id: 'b', factor: 0.7 }], live('a'));
    expect([...next.keys()]).toEqual(['a']);
  });

  it('ignores a zero or non-finite factor', () => {
    const next = recordFactors(new Map(), [{ id: 'a', factor: 0 }, { id: 'b', factor: NaN }], live('a', 'b'));
    expect(next.size).toBe(0);
  });
});
