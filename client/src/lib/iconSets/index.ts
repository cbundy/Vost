/**
 * The bundled glyph sets (icons, emojis, stickers) and what the picker and the drawings do with them: loading a set,
 * looking an entry up and searching. The data modules (icons.ts, emojis.ts, stickers.ts) are only ever loaded with a
 * dynamic `import()`, so each is its own chunk and the main bundle does not carry them.
 */
import { GLYPH_KINDS, type GlyphEntry, type GlyphKind } from './types';

export { GLYPH_KINDS, isGlyphKind } from './types';
export type { GlyphEntry, GlyphKind } from './types';

const IMPORTS: Readonly<Record<GlyphKind, () => Promise<readonly GlyphEntry[]>>> = {
  icon: () => import('./icons').then((m) => m.ICONS),
  emoji: () => import('./emojis').then((m) => m.EMOJIS),
  sticker: () => import('./stickers').then((m) => m.STICKERS),
};

type Loaded = { entries: readonly GlyphEntry[]; byId: ReadonlyMap<string, GlyphEntry> };
const loaded = new Map<GlyphKind, Loaded>();
const loading = new Map<GlyphKind, Promise<readonly GlyphEntry[]>>();
const listeners = new Set<() => void>();

/** Calls `fn` whenever a set or one of its images finishes loading (a drawing asks for a repaint); returns the unsubscribe. */
export function onGlyphLoaded(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** Tells the subscribers something finished loading. */
export function notifyGlyphLoaded(): void {
  for (const fn of [...listeners]) fn();
}

/** Loads a set (once; later calls give the same entries). A failed load is forgotten so the next call tries again. */
export function loadSet(kind: GlyphKind): Promise<readonly GlyphEntry[]> {
  const have = loaded.get(kind);
  if (have) return Promise.resolve(have.entries);
  let p = loading.get(kind);
  if (!p) {
    p = IMPORTS[kind]().then(
      (entries) => {
        loaded.set(kind, { entries, byId: new Map(entries.map((e) => [e.id, e])) });
        loading.delete(kind);
        notifyGlyphLoaded();
        return entries;
      },
      (err: unknown) => {
        loading.delete(kind);
        throw err;
      },
    );
    loading.set(kind, p);
  }
  return p;
}

/** The set's entries when it is already loaded, else undefined. */
export function loadedSet(kind: GlyphKind): readonly GlyphEntry[] | undefined {
  return loaded.get(kind)?.entries;
}

export type GlyphLookup = { state: 'loading' } | { state: 'missing' } | { state: 'ready'; entry: GlyphEntry };

/** An entry by id without waiting: 'loading' (and the set starts loading) until the set is in, then the entry or 'missing' for an unknown id. */
export function lookupGlyph(kind: GlyphKind, id: string): GlyphLookup {
  const have = loaded.get(kind);
  if (!have) {
    void loadSet(kind).catch(() => {});
    return { state: 'loading' };
  }
  const entry = have.byId.get(id);
  return entry ? { state: 'ready', entry } : { state: 'missing' };
}

/** The entries that match every word of the query (case-insensitive) in their name, keywords or category; an empty query matches all. */
export function searchGlyphs(entries: readonly GlyphEntry[], query: string, category?: string): GlyphEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (category && e.category !== category) return false;
    if (words.length === 0) return true;
    const hay = `${e.name} ${e.keywords} ${e.category}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The categories of a set in the order they first appear. */
export function categoriesOf(entries: readonly GlyphEntry[]): string[] {
  return [...new Set(entries.map((e) => e.category))];
}

/** Tool ids that place a glyph, one per set. */
export const GLYPH_TOOL_IDS: readonly string[] = GLYPH_KINDS;
