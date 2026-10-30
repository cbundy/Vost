/** The glyph picker's persisted prefs: the armed pick and the recent picks of each set. Pure, no React. */
import { isGlyphKind } from './types';

/** Most recent picks kept per tool. */
export const RECENT_MAX = 16;
/** Longest stored glyph id. */
export const GLYPH_ID_MAX = 80;

const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= GLYPH_ID_MAX;
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The stored armed glyph of each tool: only the three glyph tools, each a non-empty id string. */
export function sanitizeArmed(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isPlain(v)) return out;
  for (const [tool, id] of Object.entries(v)) if (isGlyphKind(tool) && isId(id)) out[tool] = id;
  return out;
}

/** The stored recent picks of each tool: only the three glyph tools, ids once each (newest first), at most {@link RECENT_MAX}. */
export function sanitizeRecent(v: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!isPlain(v)) return out;
  for (const [tool, list] of Object.entries(v)) {
    if (!isGlyphKind(tool) || !Array.isArray(list)) continue;
    const ids: string[] = [];
    for (const id of list) if (isId(id) && !ids.includes(id)) ids.push(id);
    if (ids.length) out[tool] = ids.slice(0, RECENT_MAX);
  }
  return out;
}

/** A recent list with a pick moved (or added) to the front, capped at {@link RECENT_MAX}. */
export function withRecent(list: readonly string[] | undefined, id: string): string[] {
  return [id, ...(list ?? []).filter((x) => x !== id)].slice(0, RECENT_MAX);
}
