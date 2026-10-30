import { describe, expect, it } from 'vitest';
import { NotePopups } from './notePopups';

describe('NotePopups', () => {
  it('hovers one drawing at a time and says when it changed', () => {
    const p = new NotePopups();
    expect(p.hover('a')).toBe(true);
    expect(p.hover('a')).toBe(false);
    expect(p.hover(null)).toBe(true);
    expect(p.hovered).toBeNull();
  });
  it('toggles a pin on and off', () => {
    const p = new NotePopups();
    p.toggle('a');
    expect(p.pinned.has('a')).toBe(true);
    p.toggle('a');
    expect(p.pinned.has('a')).toBe(false);
  });
  it('prunes pinned and hovered drawings that were deleted', () => {
    const p = new NotePopups();
    p.toggle('a');
    p.toggle('b');
    p.hover('b');
    expect(p.prune([{ id: 'a' }, { id: 'b' }])).toBe(false);
    expect(p.prune([{ id: 'a' }])).toBe(true);
    expect([...p.pinned]).toEqual(['a']);
    expect(p.hovered).toBeNull();
    p.clear();
    expect(p.pinned.size).toBe(0);
  });
});
