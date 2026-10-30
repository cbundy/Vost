import { describe, expect, it } from 'vitest';
import { ChangeSet, EditorState, Compartment } from '@codemirror/state';
import * as lib from '@codemirror/merge';
import { Chunk, getChunks, getOriginalDoc, updateOriginalDoc } from '@codemirror/merge';
import { compareExtension, originalChange } from './compareView';

const apply = (cur: string, want: string) => {
  const c = originalChange(cur, want);
  return c ? cur.slice(0, c.from) + c.insert + cur.slice(c.to) : cur;
};

describe('originalChange', () => {
  it('is null for equal texts', () => {
    expect(originalChange('abc', 'abc')).toBeNull();
    expect(originalChange('', '')).toBeNull();
  });
  it('trims the common prefix and suffix', () => {
    expect(originalChange('hello world', 'hello brave world')).toEqual({ from: 6, to: 6, insert: 'brave ' });
    expect(originalChange('abcdef', 'abXdef')).toEqual({ from: 2, to: 3, insert: 'X' });
  });
  it('edits at the start, end, insert-only, delete-only and full replacement', () => {
    expect(originalChange('abc', 'Xbc')).toEqual({ from: 0, to: 1, insert: 'X' });
    expect(originalChange('abc', 'abX')).toEqual({ from: 2, to: 3, insert: 'X' });
    expect(originalChange('abc', 'abcd')).toEqual({ from: 3, to: 3, insert: 'd' });
    expect(originalChange('abcd', 'ad')).toEqual({ from: 1, to: 3, insert: '' });
    expect(originalChange('abc', 'xyz')).toEqual({ from: 0, to: 3, insert: 'xyz' });
    expect(originalChange('', 'abc')).toEqual({ from: 0, to: 0, insert: 'abc' });
    expect(originalChange('abc', '')).toEqual({ from: 0, to: 3, insert: '' });
  });
  it('does not let prefix and suffix overlap on repeated characters', () => {
    expect(originalChange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' });
    expect(apply('aaa', 'aa')).toBe('aa');
    expect(apply('abab', 'ababab')).toBe('ababab');
  });
});

// long lines: the library re-diffs everything within 1000 characters of an edit, so chunks must lie further away than that
const lines = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `line ${i} ${tag} ${'.'.repeat(60)}`).join('\n');

describe('feeding the reference as a minimal change', () => {
  // two changed lines far from the edit at the end
  const a1 = `${lines(60, 'x')}\nlast`;
  const b = a1.replace('line 2 x', 'line 2 CHANGED').replace('line 30 x', 'line 30 CHANGED');
  const a2 = a1.replace(/last$/, 'last!');

  const feed = (state: EditorState, want: string, whole: boolean) => {
    const cur = getOriginalDoc(state);
    const c = whole ? { from: 0, to: cur.length, insert: want } : originalChange(cur.toString(), want)!;
    const changes = ChangeSet.of(c, cur.length);
    return state.update({ effects: updateOriginalDoc.of({ doc: changes.apply(cur), changes }) }).state;
  };

  it('keeps the untouched chunks and equals a fresh diff', () => {
    const s0 = EditorState.create({ doc: b, extensions: compareExtension(lib, a1) });
    const before = getChunks(s0)!.chunks;
    expect(before.length).toBe(2);
    const s1 = feed(s0, a2, false);
    const after = getChunks(s1)!.chunks;
    expect(after[0].changes).toBe(before[0].changes);
    expect(after[1].changes).toBe(before[1].changes);
    const fresh = Chunk.build(EditorState.create({ doc: a2 }).doc, s1.doc);
    expect(after.map((c) => [c.fromA, c.toA, c.fromB, c.toB])).toEqual(fresh.map((c) => [c.fromA, c.toA, c.fromB, c.toB]));
  });
  it('a whole-document replacement does not keep them (guards the test above)', () => {
    const s0 = EditorState.create({ doc: b, extensions: compareExtension(lib, a1) });
    const before = getChunks(s0)!.chunks;
    const after = getChunks(feed(s0, a2, true))!.chunks;
    expect(after[0].changes).not.toBe(before[0].changes);
  });
});

describe('rebuilding the extension', () => {
  it('a reconfigure with a new original starts from the new original', () => {
    const slot = new Compartment();
    const s0 = EditorState.create({ doc: 'a\nb', extensions: slot.of(compareExtension(lib, 'a\nb')) });
    expect(getChunks(s0)!.chunks.length).toBe(0);
    const s1 = s0.update({ effects: slot.reconfigure(compareExtension(lib, 'a\nX')) }).state;
    expect(getOriginalDoc(s1).toString()).toBe('a\nX');
    expect(getChunks(s1)!.chunks.length).toBe(1);
  });
});
