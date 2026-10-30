import { describe, expect, it, vi } from 'vitest';
import { getSnapshot, publish, subscribe, unpublish, type ActiveDrawings } from './activeDrawings';

const actions = {} as ActiveDrawings['actions'];
const none: ActiveDrawings['drawings'] = [];
const entry = (owner: object, extra: Partial<ActiveDrawings> = {}): ActiveDrawings => ({ owner, drawings: none, selected: [], hidden: false, offTimeframe: [], actions, ...extra });

describe('activeDrawings registry', () => {
  it('publish is seen by a subscriber and unpublish by the owner clears it', () => {
    const a = {};
    const seen = vi.fn();
    const off = subscribe(seen);
    const e = entry(a);
    publish(e);
    expect(getSnapshot()).toBe(e);
    expect(seen).toHaveBeenCalledTimes(1);
    unpublish(a);
    expect(getSnapshot()).toBeNull();
    expect(seen).toHaveBeenCalledTimes(2);
    off();
  });

  it('a stale owner cannot clear the new owner, and the new owner replaces the old', () => {
    const a = {};
    const b = {};
    publish(entry(a));
    const eb = entry(b);
    publish(eb);
    unpublish(a);
    expect(getSnapshot()).toBe(eb);
    unpublish(b);
    expect(getSnapshot()).toBeNull();
  });

  it('the snapshot is the same object when republished without a change, and new when something changed', () => {
    const a = {};
    const first = entry(a, { selected: ['x'] });
    publish(first);
    publish(entry(a, { selected: ['x'] }));
    expect(getSnapshot()).toBe(first);
    const next = entry(a, { selected: ['y'] });
    publish(next);
    expect(getSnapshot()).toBe(next);
    unpublish(a);
  });
});
