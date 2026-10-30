/** The three sets a glyph tool draws from; each is also the id of the drawing tool that places it. */
export type GlyphKind = 'icon' | 'emoji' | 'sticker';

export const GLYPH_KINDS: readonly GlyphKind[] = ['icon', 'emoji', 'sticker'];

export const isGlyphKind = (v: unknown): v is GlyphKind => typeof v === 'string' && (GLYPH_KINDS as readonly string[]).includes(v);

/**
 * One entry of a bundled set. `data` is SVG path data for an icon (one path per shape, joined by "|", on a 24 by 24
 * grid, stroked) and a whole full-colour SVG document for an emoji or a sticker.
 */
export type GlyphEntry = {
  id: string;
  name: string;
  /** Extra search words, space separated and lower case. */
  keywords: string;
  category: string;
  data: string;
};
