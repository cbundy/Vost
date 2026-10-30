import { describe, expect, it } from 'vitest';
import { noteFont, noteLine, textBoxLayout, type TextBoxOpts } from './textLayout';

/** One unit per character. */
const m = (s: string) => s.length;
const base: TextBoxOpts = { size: 12, bold: false, italic: false, align: 'left', pad: 6, wrap: true, wrapWidth: 10 };

describe('textBoxLayout', () => {
  it('wraps at the wrap width when wrap is on', () => {
    const l = textBoxLayout('aaaa bbbb cccc', base, m);
    expect(l.lines).toEqual(['aaaa bbbb', 'cccc']);
    expect(l.width).toBe(9 + 12);
    expect(l.height).toBe(2 * noteLine(12) + 12);
  });
  it('splits only at newlines when wrap is off', () => {
    const l = textBoxLayout('aaaa bbbb cccc\nd', { ...base, wrap: false }, m);
    expect(l.lines).toEqual(['aaaa bbbb cccc', 'd']);
    expect(l.width).toBe(14 + 12);
  });
  it('keeps explicit newlines, a blank line and a trailing one', () => {
    expect(textBoxLayout('a\n\nb\n', base, m).lines).toEqual(['a', '', 'b', '']);
    expect(textBoxLayout('a\n\nb\n', { ...base, wrap: false }, m).lines).toEqual(['a', '', 'b', '']);
  });
  it('offsets each line by its alignment', () => {
    const text = 'aaaa\nbb';
    expect(textBoxLayout(text, base, m).offsets).toEqual([6, 6]);
    expect(textBoxLayout(text, { ...base, align: 'center' }, m).offsets).toEqual([6, 7]);
    expect(textBoxLayout(text, { ...base, align: 'right' }, m).offsets).toEqual([6, 8]);
  });
  it('gives empty text one line with only padding around it', () => {
    const l = textBoxLayout('', base, m);
    expect(l.lines).toEqual(['']);
    expect(l.width).toBe(12);
    expect(l.height).toBe(noteLine(12) + 12);
  });
  it('breaks a word wider than the wrap width', () => {
    expect(textBoxLayout('abcdefghijklmno', base, m).lines).toEqual(['abcdefghij', 'klmno']);
  });
  it('caps the box at the max width', () => {
    const l = textBoxLayout('aaaa bbbb cccc', { ...base, wrapWidth: 100, maxWidth: 12 + 5 }, m);
    expect(l.lines).toEqual(['aaaa', 'bbbb', 'cccc']);
    expect(l.width).toBe(4 + 12);
    const off = textBoxLayout('aaaa bbbb cccc', { ...base, wrap: false, maxWidth: 12 + 5 }, m);
    expect(off.lines).toEqual(['aaaa', 'bbbb', 'cccc']);
  });
  it("reproduces the old note layout for Text's defaults", () => {
    // The old layout: wrapText at 240, width = ceil(widest) + 12, height = lines * line + 12.
    const w = (s: string) => s.length * 6.5;
    for (const t of ['', 'hello', 'a '.repeat(80), 'x'.repeat(100), 'one\ntwo\n\nfour']) {
      const l = textBoxLayout(t, { ...base, wrapWidth: 240 }, w);
      const widest = Math.max(...l.lines.map(w));
      expect(l.width).toBe(Math.ceil(widest) + 12);
      expect(l.height).toBe(l.lines.length * 16 + 12);
      expect(l.offsets.every((o) => o === 6)).toBe(true);
    }
  });
});

describe('noteFont', () => {
  it('names style, weight and size', () => {
    expect(noteFont({ size: 12, bold: false, italic: false })).toBe('12px sans-serif');
    expect(noteFont({ size: 14, bold: true, italic: true })).toBe('italic bold 14px sans-serif');
  });
});
