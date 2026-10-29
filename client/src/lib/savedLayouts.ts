/**
 * Named layouts kept in the browser. Each entry holds a snapshot: the same record `layout.v1` holds (the working
 * copy, written on every change). Pure transforms like the watchlists have; the store applies them.
 */
import { uid } from '../types';
import { loadJson, saveJson } from './storage';
import { parseLayout, type LayoutRecord } from './layouts';

export const SAVED_LAYOUTS_KEY = 'savedLayouts.v1';
export const SAVED_LAYOUTS_VERSION = 1;
export const DEFAULT_LAYOUT_NAME = 'Unnamed';
export const MAX_LAYOUT_NAME = 64;
export const RECENT_LAYOUTS = 5;

export interface SavedLayout {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  layout: LayoutRecord;
}

export interface SavedLayoutsState {
  version: number;
  currentId: string;
  autosave: boolean;
  layouts: SavedLayout[];
}

/** Trims a name; null when it is empty. A longer one is cut to the cap. */
export function cleanName(raw: string): string | null {
  const name = raw.trim().slice(0, MAX_LAYOUT_NAME).trim();
  return name ? name : null;
}

function entry(name: string, layout: LayoutRecord, now: number): SavedLayout {
  return { id: uid('lay-'), name, createdAt: now, updatedAt: now, lastUsedAt: now, layout };
}

/** One layout named "Unnamed" from the working layout, current, autosave on. */
export function seedFrom(layout: LayoutRecord, now = Date.now()): SavedLayoutsState {
  const e = entry(DEFAULT_LAYOUT_NAME, layout, now);
  return { version: SAVED_LAYOUTS_VERSION, currentId: e.id, autosave: true, layouts: [e] };
}

export function currentEntry(s: SavedLayoutsState): SavedLayout | undefined {
  return s.layouts.find((l) => l.id === s.currentId);
}

/** A new layout from a snapshot; it becomes the current one. An empty name changes nothing. */
export function createLayout(s: SavedLayoutsState, name: string, layout: LayoutRecord, now = Date.now()): SavedLayoutsState {
  const n = cleanName(name);
  if (!n) return s;
  const e = entry(n, layout, now);
  return { ...s, currentId: e.id, layouts: [...s.layouts, e] };
}

/** A copy of the current layout, holding the given working snapshot, named and made current. */
export function copyLayout(s: SavedLayoutsState, name: string, layout: LayoutRecord, now = Date.now()): SavedLayoutsState {
  return createLayout(s, name, layout, now);
}

export function renameLayout(s: SavedLayoutsState, id: string, name: string): SavedLayoutsState {
  const n = cleanName(name);
  if (!n || !s.layouts.some((l) => l.id === id)) return s;
  return { ...s, layouts: s.layouts.map((l) => (l.id === id ? { ...l, name: n } : l)) };
}

/** Removes a layout; the current one is refused (the state comes back unchanged). */
export function deleteLayout(s: SavedLayoutsState, id: string): SavedLayoutsState {
  if (id === s.currentId || !s.layouts.some((l) => l.id === id)) return s;
  return { ...s, layouts: s.layouts.filter((l) => l.id !== id) };
}

/** Makes a layout current and marks it used now. */
export function setCurrent(s: SavedLayoutsState, id: string, now = Date.now()): SavedLayoutsState {
  if (!s.layouts.some((l) => l.id === id)) return s;
  return { ...s, currentId: id, layouts: s.layouts.map((l) => (l.id === id ? { ...l, lastUsedAt: now } : l)) };
}

/** Writes a snapshot into one entry and stamps `updatedAt`. */
export function writeSnapshot(s: SavedLayoutsState, id: string, layout: LayoutRecord, now = Date.now()): SavedLayoutsState {
  if (!s.layouts.some((l) => l.id === id)) return s;
  return { ...s, layouts: s.layouts.map((l) => (l.id === id ? { ...l, layout, updatedAt: now } : l)) };
}

export function setAutosave(s: SavedLayoutsState, on: boolean): SavedLayoutsState {
  return s.autosave === on ? s : { ...s, autosave: on };
}

/** Up to `n` layouts other than the current one, the most recently used first. */
export function recent(s: SavedLayoutsState, n = RECENT_LAYOUTS): SavedLayout[] {
  return s.layouts
    .filter((l) => l.id !== s.currentId)
    .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
    .slice(0, n);
}

/** Layouts whose name contains the text (any case), in the order kept; an empty text lists them all. */
export function search(s: SavedLayoutsState, text: string): SavedLayout[] {
  const q = text.trim().toLowerCase();
  return q ? s.layouts.filter((l) => l.name.toLowerCase().includes(q)) : s.layouts;
}

/** Whether the working snapshot differs from what the entry holds. */
export function isDirty(e: SavedLayout | undefined, snapshot: LayoutRecord): boolean {
  return !e || JSON.stringify(e.layout) !== JSON.stringify(snapshot);
}

/** The active chart's market of a snapshot, for the lists ("BTCUSDT, 1W"). */
export function activeMarket(layout: LayoutRecord): string {
  const c = layout.charts.find((x) => x.id === layout.activeChartId) ?? layout.charts[0];
  return c ? `${c.symbol}, ${c.timeframe}` : '';
}

/** Reads the stored state; bad entries are dropped and a missing current falls back to the latest used. Null when nothing usable. */
export function parseSavedLayouts(raw: unknown): SavedLayoutsState | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== SAVED_LAYOUTS_VERSION || !Array.isArray(r.layouts)) return null;
  const seen = new Set<string>();
  const layouts: SavedLayout[] = [];
  for (const x of r.layouts) {
    if (!x || typeof x !== 'object' || Array.isArray(x)) continue;
    const e = x as Record<string, unknown>;
    if (typeof e.id !== 'string' || !e.id || seen.has(e.id)) continue;
    const name = typeof e.name === 'string' ? cleanName(e.name) : null;
    if (!name || !parseLayout(e.layout)) continue;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    seen.add(e.id);
    layouts.push({ id: e.id, name, createdAt: num(e.createdAt), updatedAt: num(e.updatedAt), lastUsedAt: num(e.lastUsedAt), layout: e.layout as LayoutRecord });
  }
  if (layouts.length === 0) return null;
  const latest = [...layouts].sort((a, b) => b.lastUsedAt - a.lastUsedAt)[0];
  const currentId = typeof r.currentId === 'string' && seen.has(r.currentId) ? r.currentId : latest.id;
  return { version: SAVED_LAYOUTS_VERSION, currentId, autosave: r.autosave !== false, layouts };
}

export function loadSavedLayouts(): SavedLayoutsState | null {
  return parseSavedLayouts(loadJson<unknown>(SAVED_LAYOUTS_KEY, null));
}

export function saveSavedLayouts(s: SavedLayoutsState): { ok: boolean; error?: string } {
  return saveJson(SAVED_LAYOUTS_KEY, s);
}
