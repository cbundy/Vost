/**
 * Pure model for chart drawings: types, edits, undo/redo history, the per-source key
 * and the versioned browser storage payload. No chart or React imports.
 */
import { debounce, loadJson, saveJson } from './storage';

export type Anchor = { time: number; price: number };

/** Anchors each known tool id needs; the registry (components/chart/tools) is the one source of it. */
export type AnchorCounts = Readonly<Record<string, number>>;

export type Drawing = { id: string; tool: string; anchors: Anchor[] };

export const HISTORY_LIMIT = 100;
export const STORAGE_KEY = 'drawings.v1';
export const STORAGE_VERSION = 1;

/** The drawings of one chart source with their undo and redo stacks (snapshots, newest last). */
export type DrawingsState = { drawings: Drawing[]; past: Drawing[][]; future: Drawing[][] };

export const emptyState = (drawings: Drawing[] = []): DrawingsState => ({ drawings, past: [], future: [] });

export function sourceKey(src: { providerId: string; symbol: string; activeDatasetId: string | null }): string {
  return src.activeDatasetId ? `local:${src.activeDatasetId}` : `${src.providerId}:${src.symbol}`;
}

let counter = 0;
export function newDrawingId(): string {
  counter += 1;
  return `d${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Records `before` as an undo step and clears redo. */
function record(s: DrawingsState, before: Drawing[], drawings: Drawing[]): DrawingsState {
  const past = [...s.past, before];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { drawings, past, future: [] };
}

export function add(s: DrawingsState, d: Drawing): DrawingsState {
  return record(s, s.drawings, [...s.drawings, d]);
}

/** Replaces one drawing's anchors as an undoable step. */
export function update(s: DrawingsState, id: string, anchors: Anchor[]): DrawingsState {
  if (!s.drawings.some((d) => d.id === id)) return s;
  return record(s, s.drawings, s.drawings.map((d) => (d.id === id ? { ...d, anchors } : d)));
}

export function remove(s: DrawingsState, id: string): DrawingsState {
  if (!s.drawings.some((d) => d.id === id)) return s;
  return record(s, s.drawings, s.drawings.filter((d) => d.id !== id));
}

/** Live drag preview: changes the anchors without touching history. Pair with {@link commit}. */
export function preview(s: DrawingsState, id: string, anchors: Anchor[]): DrawingsState {
  return { ...s, drawings: s.drawings.map((d) => (d.id === id ? { ...d, anchors } : d)) };
}

/** Ends a drag: records `before` (the drawings when the drag began) as one undo step if anything changed. */
export function commit(s: DrawingsState, before: Drawing[]): DrawingsState {
  if (JSON.stringify(before) === JSON.stringify(s.drawings)) return { ...s, drawings: before };
  return record(s, before, s.drawings);
}

export function undo(s: DrawingsState): DrawingsState {
  const prev = s.past[s.past.length - 1];
  if (!prev) return s;
  return { drawings: prev, past: s.past.slice(0, -1), future: [...s.future, s.drawings] };
}

export function redo(s: DrawingsState): DrawingsState {
  const next = s.future[s.future.length - 1];
  if (!next) return s;
  return { drawings: next, past: [...s.past, s.drawings], future: s.future.slice(0, -1) };
}

/* ------------------------------ storage ------------------------------ */

export type DrawingStore = {
  sources: Record<string, Drawing[]>;
  /** A payload from a newer app version was found: nothing was read and it is kept until the user draws. */
  newer: boolean;
};

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

function sanitizeDrawing(raw: unknown, counts: AnchorCounts): Drawing | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.tool !== 'string') return null;
  const need = Object.prototype.hasOwnProperty.call(counts, r.tool) ? counts[r.tool] : 0;
  if (!need || !Array.isArray(r.anchors) || r.anchors.length !== need) return null;
  const anchors: Anchor[] = [];
  for (const a of r.anchors) {
    if (!a || typeof a !== 'object') return null;
    const { time, price } = a as Record<string, unknown>;
    if (!finite(time) || !finite(price)) return null;
    anchors.push({ time, price });
  }
  return { id: r.id, tool: r.tool, anchors };
}

/** Parses a stored payload; anything unusable gives no drawings and a bad item is dropped alone. */
export function parseStore(raw: unknown, counts: AnchorCounts): DrawingStore {
  const none: DrawingStore = { sources: {}, newer: false };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return none;
  const r = raw as Record<string, unknown>;
  if (finite(r.version) && r.version > STORAGE_VERSION) return { sources: {}, newer: true };
  if (r.version !== STORAGE_VERSION) return none;
  if (!r.sources || typeof r.sources !== 'object' || Array.isArray(r.sources)) return none;
  const sources: Record<string, Drawing[]> = {};
  for (const [key, list] of Object.entries(r.sources as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    const ok: Drawing[] = [];
    for (const item of list) {
      const d = sanitizeDrawing(item, counts);
      if (d && !seen.has(d.id)) {
        seen.add(d.id);
        ok.push(d);
      }
    }
    if (ok.length) sources[key] = ok;
  }
  return { sources, newer: false };
}

export function loadDrawings(counts: AnchorCounts): DrawingStore {
  return parseStore(loadJson<unknown>(STORAGE_KEY, null), counts);
}

/** Writes the sources. Only call after the user changed something (so a newer payload is never overwritten by a load). */
export function saveDrawings(sources: Record<string, Drawing[]>): void {
  const clean: Record<string, Drawing[]> = {};
  for (const [k, v] of Object.entries(sources)) if (v.length) clean[k] = v;
  saveJson(STORAGE_KEY, { version: STORAGE_VERSION, sources: clean });
}

/** A debounced saver; `flush()` writes a pending save at once (call it on pagehide). */
export function createDrawingSaver(wait = 400) {
  return debounce(saveDrawings, wait);
}
