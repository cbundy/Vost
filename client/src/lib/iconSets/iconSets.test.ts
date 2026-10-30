import { describe, expect, it } from 'vitest';
import { GLYPH_KINDS, categoriesOf, loadSet, loadedSet, lookupGlyph, searchGlyphs, type GlyphEntry } from './index';

const E = (id: string, name: string, keywords: string, category = 'A'): GlyphEntry => ({ id, name, keywords, category, data: 'M0 0' });
const sample = [E('up', 'arrow up', 'direction north'), E('down', 'arrow down', 'direction south', 'B'), E('flag', 'flag', 'marker pin', 'B'), E('smile', 'Grinning Face', 'happy')];

describe('searchGlyphs', () => {
  it('matches by name, by keyword and by two words, in any case', () => {
    expect(searchGlyphs(sample, 'flag').map((e) => e.id)).toEqual(['flag']);
    expect(searchGlyphs(sample, 'north').map((e) => e.id)).toEqual(['up']);
    expect(searchGlyphs(sample, 'arrow south').map((e) => e.id)).toEqual(['down']);
    expect(searchGlyphs(sample, 'GRINNING').map((e) => e.id)).toEqual(['smile']);
    expect(searchGlyphs(sample, '  Arrow   DIRECTION ').map((e) => e.id)).toEqual(['up', 'down']);
  });
  it('needs every word to match, and gives an empty list for no match', () => {
    expect(searchGlyphs(sample, 'arrow happy')).toEqual([]);
    expect(searchGlyphs(sample, 'zzz')).toEqual([]);
  });
  it('gives everything for an empty query and filters by category', () => {
    expect(searchGlyphs(sample, '')).toHaveLength(4);
    expect(searchGlyphs(sample, '', 'B').map((e) => e.id)).toEqual(['down', 'flag']);
    expect(searchGlyphs(sample, 'arrow', 'B').map((e) => e.id)).toEqual(['down']);
    expect(categoriesOf(sample)).toEqual(['A', 'B']);
  });
});

describe('the bundled sets', () => {
  it('load through the dynamic import for each kind, with the sizes the brief asks for', async () => {
    const ranges = { icon: [150, 300], emoji: [200, 400], sticker: [40, 100] } as const;
    for (const kind of GLYPH_KINDS) {
      expect(loadedSet(kind)).toBeUndefined();
      const entries = await loadSet(kind);
      expect(loadedSet(kind)).toBe(entries);
      expect(entries.length, kind).toBeGreaterThanOrEqual(ranges[kind][0]);
      expect(entries.length, kind).toBeLessThanOrEqual(ranges[kind][1]);
    }
  });
  it('give every entry a unique id, a name, a category and data', async () => {
    for (const kind of GLYPH_KINDS) {
      const entries = await loadSet(kind);
      expect(new Set(entries.map((e) => e.id)).size, kind).toBe(entries.length);
      for (const e of entries) {
        expect(e.id, kind).toBeTruthy();
        expect(e.name, e.id).toBeTruthy();
        expect(e.category, e.id).toBeTruthy();
        expect(e.keywords, e.id).toBe(e.keywords.toLowerCase());
        expect(e.data, e.id).toBeTruthy();
        if (kind === 'icon') expect(e.data, e.id).toMatch(/^[Mm]/);
        else expect(e.data, e.id).toMatch(/^<svg\b/);
      }
    }
  });
  it('can be searched by an icon name and finds the arrows', async () => {
    const icons = await loadSet('icon');
    expect(searchGlyphs(icons, 'arrow').length).toBeGreaterThan(5);
    expect(searchGlyphs(icons, 'ARROW up').map((e) => e.id)).toContain('arrow-up');
  });
  it('look an entry up: ready for a known id, missing for an unknown one', async () => {
    const icons = await loadSet('icon');
    expect(lookupGlyph('icon', icons[0].id)).toEqual({ state: 'ready', entry: icons[0] });
    expect(lookupGlyph('icon', 'no-such-icon')).toEqual({ state: 'missing' });
  });
});
