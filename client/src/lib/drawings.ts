/**
 * Pure model for chart drawings: types, edits, undo/redo history, the per-source key
 * and the versioned browser storage payload. No chart or React imports.
 */
import { debounce, loadJson, peekJson, saveJson } from './storage';

/**
 * A point of a drawing. For most tools `time` (unix seconds) and `price` place it on the chart. A pane-anchored
 * tool (`paneAnchored` on the tool) stores the point's x and y as fractions of the pane in `time` and `price`, each
 * 0..1, so it stays at the same spot on the pane whatever the chart does.
 */
export type Anchor = { time: number; price: number };

/** How many anchors a tool takes: a fixed count, or a range for a tool placed point by point (path, polyline). */
export type AnchorSpec = number | { min: number; max: number };

/** The least and most anchors of a tool, whether it declares a count or a range (a count is the range of that count to itself). */
export function anchorRange(spec: AnchorSpec): { min: number; max: number } {
  return typeof spec === 'number' ? { min: spec, max: spec } : spec;
}

/** Anchors each known tool id needs; the registry (components/chart/tools) is the one source of it. */
export type AnchorCounts = Readonly<Record<string, AnchorSpec>>;

/**
 * `text` is only set by tools that store text (a note). `style` holds the drawing's own style values (colour, width
 * and so on, see lib/drawingStyle); a drawing without it looks like the tool's default. A stored drawing may carry
 * more fields than these, or belong to a tool this app does not know: those are kept as they were stored.
 */
export type Drawing = {
  id: string;
  tool: string;
  anchors: Anchor[];
  text?: string;
  style?: Record<string, unknown>;
  /** A locked drawing can be selected but not moved or reshaped. */
  locked?: true;
  /** The drawing's own name, shown in the right-click menu. */
  name?: string;
  /** The content of a table (rows of equal length, 1..20 by 1..20); only the Table tool has it. */
  cells?: string[][];
  /** The picture of an Image drawing: its key in the picture store (SHA-256 hex of the bytes) and its natural size. */
  image?: { key: string; w: number; h: number };
};

/** Longest stored name of a drawing. */
export const NAME_MAX = 60;

/** A drawing's name as stored: trimmed, control characters turned to spaces, and cut to {@link NAME_MAX} characters. */
export function cleanName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, NAME_MAX).trim();
}

/** Longest stored text of a note. */
export const TEXT_MAX = 500;

/** A note's text as stored: trimmed and cut to {@link TEXT_MAX} characters. */
export function cleanText(text: string): string {
  return text.trim().slice(0, TEXT_MAX);
}

export const HISTORY_LIMIT = 100;
export const STORAGE_KEY = 'drawings.v2';
export const STORAGE_VERSION = 2;
/** Where version 1 kept the drawings; read once when version 2 has nothing yet, and never written or removed. */
export const LEGACY_KEY_V1 = 'drawings.v1';

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

/** Replaces one drawing's text as an undoable step; the same state when it is unchanged. */
export function setText(s: DrawingsState, id: string, text: string): DrawingsState {
  const clean = cleanText(text);
  const d = s.drawings.find((x) => x.id === id);
  if (!d || d.text === clean) return s;
  return record(s, s.drawings, s.drawings.map((x) => (x.id === id ? { ...x, text: clean } : x)));
}

/** Replaces one cell of a table as an undoable step; the same state when the cell is unchanged or does not exist. */
export function setCell(s: DrawingsState, id: string, row: number, col: number, text: string): DrawingsState {
  const clean = cleanText(text);
  return mapIds(s, [id], (d) => {
    if (!d.cells || d.cells[row]?.[col] === undefined || d.cells[row][col] === clean) return d;
    return { ...d, cells: d.cells.map((r, i) => (i === row ? r.map((c, j) => (j === col ? clean : c)) : r)) };
  });
}

/** Replaces a table's cells as an undoable step; the same state when they are unchanged. */
export function setCells(s: DrawingsState, id: string, cells: string[][]): DrawingsState {
  return mapIds(s, [id], (d) => (sameJson(d.cells, cells) ? d : { ...d, cells }));
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Replaces one drawing's style as an undoable step (no style at all, or an empty one, clears it); the same state when unchanged. */
export function setStyle(s: DrawingsState, id: string, style: Record<string, unknown> | undefined): DrawingsState {
  const next = style && Object.keys(style).length ? style : undefined;
  const d = s.drawings.find((x) => x.id === id);
  if (!d || sameJson(d.style, next)) return s;
  return record(s, s.drawings, s.drawings.map((x) => (x.id === id ? withStyle(x, next) : x)));
}

function withStyle(d: Drawing, style: Record<string, unknown> | undefined): Drawing {
  const { style: _old, ...rest } = d;
  return style ? { ...rest, style } : rest;
}

/** What the settings dialog may change at once. */
export type DrawingPatch = { anchors?: Anchor[]; text?: string; cells?: string[][]; style?: Record<string, unknown> | undefined };

/** Live preview of dialog edits: changes the drawing without touching history. Pair with {@link commit}. */
export function previewPatch(s: DrawingsState, id: string, patch: DrawingPatch): DrawingsState {
  return {
    ...s,
    drawings: s.drawings.map((d) => {
      if (d.id !== id) return d;
      let next: Drawing = patch.anchors ? { ...d, anchors: patch.anchors } : d;
      if (patch.text !== undefined) {
        const { text: _old, ...rest } = next;
        next = patch.text ? { ...rest, text: patch.text } : rest;
      }
      if (patch.cells) next = { ...next, cells: patch.cells };
      if ('style' in patch) next = withStyle(next, patch.style && Object.keys(patch.style).length ? patch.style : undefined);
      return next;
    }),
  };
}

export function remove(s: DrawingsState, id: string): DrawingsState {
  if (!s.drawings.some((d) => d.id === id)) return s;
  return record(s, s.drawings, s.drawings.filter((d) => d.id !== id));
}

/** Removes every drawing as one undoable step; the same state when there is nothing to remove. */
export function removeAll(s: DrawingsState): DrawingsState {
  if (s.drawings.length === 0) return s;
  return record(s, s.drawings, []);
}

function mapIds(s: DrawingsState, ids: readonly string[], f: (d: Drawing) => Drawing): DrawingsState {
  const set = new Set(ids);
  let changed = false;
  const drawings = s.drawings.map((d) => {
    if (!set.has(d.id)) return d;
    const n = f(d);
    if (n !== d) changed = true;
    return n;
  });
  return changed ? record(s, s.drawings, drawings) : s;
}

/** Locks or unlocks drawings as one undoable step; the same state when none changes. */
export function setLocked(s: DrawingsState, ids: readonly string[], locked: boolean): DrawingsState {
  return mapIds(s, ids, (d) => {
    if ((d.locked === true) === locked) return d;
    const { locked: _old, ...rest } = d;
    return locked ? { ...rest, locked: true } : rest;
  });
}

/** Names a drawing as an undoable step (an empty name clears it); the same state when unchanged. */
export function rename(s: DrawingsState, id: string, name: string): DrawingsState {
  const clean = cleanName(name);
  return mapIds(s, [id], (d) => {
    if ((d.name ?? '') === clean) return d;
    const { name: _old, ...rest } = d;
    return clean ? { ...rest, name: clean } : rest;
  });
}

export type ReorderTo = 'front' | 'back' | 'forward' | 'backward';

/**
 * Moves drawings in the paint order (last paints on top) as one undoable step; the same state when nothing would change.
 * Front and back keep the moved drawings' relative order; forward and backward move each one past its nearest
 * unselected neighbour.
 */
export function reorderMany(s: DrawingsState, ids: readonly string[], to: ReorderTo): DrawingsState {
  const set = new Set(ids);
  const list = s.drawings;
  let out: Drawing[];
  if (to === 'front' || to === 'back') {
    const picked = list.filter((d) => set.has(d.id));
    const rest = list.filter((d) => !set.has(d.id));
    out = to === 'front' ? [...rest, ...picked] : [...picked, ...rest];
  } else {
    out = [...list];
    if (to === 'forward') {
      for (let i = out.length - 2; i >= 0; i--) if (set.has(out[i].id) && !set.has(out[i + 1].id)) [out[i], out[i + 1]] = [out[i + 1], out[i]];
    } else {
      for (let i = 1; i < out.length; i++) if (set.has(out[i].id) && !set.has(out[i - 1].id)) [out[i], out[i - 1]] = [out[i - 1], out[i]];
    }
  }
  return out.every((d, i) => d === list[i]) ? s : record(s, list, out);
}

/** Moves one drawing in the paint order as an undoable step; the same state when it already sits there. */
export const reorder = (s: DrawingsState, id: string, to: ReorderTo): DrawingsState => reorderMany(s, [id], to);

const copyOf = (d: Drawing): Drawing => ({ ...JSON.parse(JSON.stringify(d)), id: newDrawingId() });

/** Copies drawings under new ids, each copy just above its original, as one undoable step. */
export function cloneMany(s: DrawingsState, ids: readonly string[]): DrawingsState {
  const set = new Set(ids);
  if (!s.drawings.some((d) => set.has(d.id))) return s;
  const drawings: Drawing[] = [];
  for (const d of s.drawings) {
    drawings.push(d);
    if (set.has(d.id)) drawings.push(copyOf(d));
  }
  return record(s, s.drawings, drawings);
}

/** Adds copies of drawings (from another chart or an earlier copy) on top under new ids as one undoable step. */
export function paste(s: DrawingsState, drawings: readonly Drawing[]): DrawingsState {
  if (drawings.length === 0) return s;
  return record(s, s.drawings, [...s.drawings, ...drawings.map(copyOf)]);
}

/** Removes several drawings as one undoable step; the same state when none exists. */
export function removeMany(s: DrawingsState, ids: readonly string[]): DrawingsState {
  const set = new Set(ids);
  if (!s.drawings.some((d) => set.has(d.id))) return s;
  return record(s, s.drawings, s.drawings.filter((d) => !set.has(d.id)));
}

/** Live drag preview: changes the anchors without touching history. Pair with {@link commit}. */
export function preview(s: DrawingsState, id: string, anchors: Anchor[]): DrawingsState {
  return { ...s, drawings: s.drawings.map((d) => (d.id === id ? { ...d, anchors } : d)) };
}

/** Live drag preview of several drawings at once: each id in `moves` gets its anchors, history untouched. */
export function previewMany(s: DrawingsState, moves: Readonly<Record<string, Anchor[]>>): DrawingsState {
  return { ...s, drawings: s.drawings.map((d) => (Object.prototype.hasOwnProperty.call(moves, d.id) ? { ...d, anchors: moves[d.id] } : d)) };
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

const NO_TOOLS: ReadonlySet<string> = new Set();

/** A tool's check of a drawing after the generic ones: the drawing as it should be kept, or null to drop it. */
export type DrawingValidator = (d: Drawing) => Drawing | null;
/** The validators by tool id (see `VALIDATORS` in components/chart/tools). */
export type Validators = Readonly<Record<string, DrawingValidator>>;
const NO_VALIDATORS: Validators = {};

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * One stored drawing. A drawing of a tool this app does not know is kept exactly as stored (it is neither painted
 * nor hit). A known tool's drawing keeps every stored field, but its anchors and text are validated: a bad one
 * drops that drawing alone. A transient tool's drawing (the measure) is never kept.
 */
function sanitizeDrawing(
  raw: unknown,
  counts: AnchorCounts,
  textTools: ReadonlySet<string>,
  transient: ReadonlySet<string>,
  paneTools: ReadonlySet<string>,
  captionTools: ReadonlySet<string>,
  validators: Validators,
): Drawing | null {
  const out = sanitizeKnown(raw, counts, textTools, transient, paneTools, captionTools);
  if (!out || !Object.prototype.hasOwnProperty.call(counts, out.tool)) return out;
  const validate = Object.prototype.hasOwnProperty.call(validators, out.tool) ? validators[out.tool] : undefined;
  return validate ? validate(out) : out;
}

function sanitizeKnown(
  raw: unknown,
  counts: AnchorCounts,
  textTools: ReadonlySet<string>,
  transient: ReadonlySet<string>,
  paneTools: ReadonlySet<string>,
  captionTools: ReadonlySet<string>,
): Drawing | null {
  if (!isPlain(raw)) return null;
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.tool !== 'string') return null;
  if (transient.has(raw.tool)) return null;
  if (!Object.prototype.hasOwnProperty.call(counts, raw.tool)) return raw as Drawing;
  const { min, max } = anchorRange(counts[raw.tool]);
  if (!min || !Array.isArray(raw.anchors) || raw.anchors.length < min || raw.anchors.length > max) return null;
  const anchors: Anchor[] = [];
  for (const a of raw.anchors) {
    if (!isPlain(a)) return null;
    const { time, price } = a;
    if (!finite(time) || !finite(price)) return null;
    // A pane-anchored point is a pair of pane fractions: one outside 0..1 is clamped onto the pane.
    const pane = paneTools.has(raw.tool);
    anchors.push({ ...a, time: pane ? Math.min(1, Math.max(0, time)) : time, price: pane ? Math.min(1, Math.max(0, price)) : price });
  }
  const { text: rawText, style: rawStyle, locked: rawLocked, name: rawName, ...rest } = raw;
  const out: Drawing = { ...(rest as Drawing), anchors };
  if (isPlain(rawStyle)) out.style = rawStyle;
  if (rawLocked === true) out.locked = true;
  const name = typeof rawName === 'string' ? cleanName(rawName) : '';
  if (name) out.name = name;
  if (captionTools.has(raw.tool)) {
    const label = typeof rawText === 'string' ? cleanText(rawText) : '';
    return label ? { ...out, text: label } : out;
  }
  if (!textTools.has(raw.tool)) return out;
  const text = typeof rawText === 'string' ? cleanText(rawText) : '';
  if (!text) return null;
  return { ...out, text };
}

/** Parses a stored payload (version 1 or 2); anything unusable gives no drawings and a bad item is dropped alone. */
export function parseStore(
  raw: unknown,
  counts: AnchorCounts,
  textTools: ReadonlySet<string> = NO_TOOLS,
  transient: ReadonlySet<string> = NO_TOOLS,
  paneTools: ReadonlySet<string> = NO_TOOLS,
  captionTools: ReadonlySet<string> = NO_TOOLS,
  validators: Validators = NO_VALIDATORS,
): DrawingStore {
  const none: DrawingStore = { sources: {}, newer: false };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return none;
  const r = raw as Record<string, unknown>;
  if (finite(r.version) && r.version > STORAGE_VERSION) return { sources: {}, newer: true };
  if (r.version !== STORAGE_VERSION && r.version !== 1) return none;
  if (!r.sources || typeof r.sources !== 'object' || Array.isArray(r.sources)) return none;
  const sources: Record<string, Drawing[]> = {};
  for (const [key, list] of Object.entries(r.sources as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const seen = new Set<string>();
    const ok: Drawing[] = [];
    for (const item of list) {
      const d = sanitizeDrawing(item, counts, textTools, transient, paneTools, captionTools, validators);
      if (d && !seen.has(d.id)) {
        seen.add(d.id);
        ok.push(d);
      }
    }
    if (ok.length) sources[key] = ok;
  }
  return { sources, newer: false };
}

/** Reads version 2; when it has nothing yet, reads (and so migrates) version 1, which is left as it is. */
export function loadDrawings(
  counts: AnchorCounts,
  textTools: ReadonlySet<string> = NO_TOOLS,
  transient: ReadonlySet<string> = NO_TOOLS,
  paneTools: ReadonlySet<string> = NO_TOOLS,
  captionTools: ReadonlySet<string> = NO_TOOLS,
  validators: Validators = NO_VALIDATORS,
): DrawingStore {
  const v2 = loadJson<unknown>(STORAGE_KEY, null);
  return parseStore(v2 ?? loadJson<unknown>(LEGACY_KEY_V1, null), counts, textTools, transient, paneTools, captionTools, validators);
}

/** The picture keys a list of drawings refers to; any drawing with an `image.key` counts, whatever its tool. */
export function imageKeys(drawings: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const d of drawings) {
    const key = isPlain(d) && isPlain(d.image) ? d.image.key : undefined;
    if (typeof key === 'string') out.push(key);
  }
  return out;
}

/** Every picture key a state refers to: its drawings and its undo and redo snapshots. */
export function stateImageKeys(s: DrawingsState): string[] {
  return [...imageKeys(s.drawings), ...s.past.flatMap(imageKeys), ...s.future.flatMap(imageKeys)];
}

/**
 * The picture keys of every stored drawing of every source, read fresh from storage (other tabs share it). Null when
 * storage cannot be read; `newer` when the payload is from a newer app, which this one cannot read completely.
 */
export function persistedImageKeys(): { keys: Set<string>; newer: boolean } | null {
  const r = peekJson(STORAGE_KEY);
  if (!r.ok) return null;
  const v = r.value;
  if (v === null) return { keys: new Set(), newer: false };
  if (!isPlain(v)) return null;
  if (finite(v.version) && v.version > STORAGE_VERSION) return { keys: new Set(), newer: true };
  const keys = new Set<string>();
  if (isPlain(v.sources)) for (const list of Object.values(v.sources)) if (Array.isArray(list)) for (const k of imageKeys(list)) keys.add(k);
  return { keys, newer: false };
}

/** Writes the sources. Only call after the user changed something (so a newer payload is never overwritten by a load). */
export function saveDrawings(sources: Record<string, Drawing[]>): void {
  const clean: Record<string, Drawing[]> = {};
  for (const [k, v] of Object.entries(sources)) if (v.length) clean[k] = v;
  saveJson(STORAGE_KEY, { version: STORAGE_VERSION, sources: clean });
}

/* --------------------------- one store per tab --------------------------- */

export type DrawingsStorage = {
  /** The stored drawings of one source (loaded once, on first use). */
  get(key: string): Drawing[];
  /** Replaces a source's drawings, saves (debounced) and tells every subscriber which source changed. */
  set(key: string, drawings: Drawing[]): void;
  /** Called with the changed source's key after each `set`; returns the unsubscribe. */
  subscribe(listener: (key: string) => void): () => void;
  /** Writes a pending save now (call it on pagehide). */
  flush(): void;
};

/**
 * The one in-memory copy of every chart's drawings and the one saver, shared by all charts on the page, so charts
 * showing different sources never overwrite each other's save and charts on one source see each other's edits.
 */
export function createDrawingsStorage(load: () => Record<string, Drawing[]>, save: (sources: Record<string, Drawing[]>) => void, wait = 400): DrawingsStorage {
  let sources: Record<string, Drawing[]> | null = null;
  const saver = debounce(save, wait);
  const listeners = new Set<(key: string) => void>();
  return {
    get(key) {
      sources ??= load();
      return sources[key] ?? [];
    },
    set(key, drawings) {
      sources = { ...(sources ?? load()), [key]: drawings };
      saver(sources);
      for (const l of [...listeners]) l(key);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    flush: () => saver.flush(),
  };
}
