import { describe, expect, it } from 'vitest';
import { placeChar } from './pineCharPrimitive';

describe('placeChar', () => {
  it('puts a glyph above the anchor with its text above it', () => {
    const p = placeChar(100, 'above', 14, true);
    expect(p.glyphY).toBeLessThan(100);
    expect(p.textY!).toBeLessThan(p.glyphY);
  });

  it('puts a glyph below the anchor with its text below it', () => {
    const p = placeChar(100, 'below', 14, true);
    expect(p.glyphY).toBeGreaterThan(100);
    expect(p.textY!).toBeGreaterThan(p.glyphY);
  });

  it('centres a glyph on the anchor, its text under it, and has no text row without text', () => {
    const p = placeChar(100, 'center', 14, true);
    expect(p.glyphY).toBe(100);
    expect(p.textY!).toBeGreaterThan(100);
    expect(placeChar(100, 'above', 14, false).textY).toBeNull();
  });

  it('keeps a bigger glyph further from the anchor', () => {
    expect(placeChar(100, 'above', 28, false).glyphY).toBeLessThan(placeChar(100, 'above', 9, false).glyphY);
  });

  it('keeps a glyph and its text inside the pane', () => {
    const top = placeChar(2, 'above', 28, true, 200);
    expect(top.glyphY).toBeGreaterThanOrEqual(14);
    expect(top.textY!).toBeGreaterThanOrEqual(top.textPx / 2);
    const bottom = placeChar(199, 'below', 28, true, 200);
    expect(bottom.glyphY).toBeLessThanOrEqual(186);
    expect(bottom.textY!).toBeLessThanOrEqual(200 - bottom.textPx / 2);
  });
});
