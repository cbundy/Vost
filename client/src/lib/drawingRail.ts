import { TOOLS } from '../components/chart/tools';
import type { DrawingGroup, DrawingTool } from '../components/chart/tools';

/** The tool id of the plain cursor mode (select and move drawings). */
export const CURSOR = 'cursor';
/** The tool id of the eraser mode: a press on a drawing deletes it. */
export const ERASER = 'eraser';

export type CursorKind = 'cross' | 'dot' | 'arrow';
export const CURSOR_KINDS: readonly CursorKind[] = ['cross', 'dot', 'arrow'];

/** The rail's families in rail order, with the label on the flyout and the tooltip. */
export const GROUP_ORDER: readonly DrawingGroup[] = ['cursors', 'lines', 'fib-gann', 'patterns', 'forecast-measure', 'shapes', 'annotations', 'icons'];
export const GROUP_LABELS: Readonly<Record<DrawingGroup, string>> = {
  cursors: 'Cursors',
  lines: 'Lines',
  'fib-gann': 'Fibonacci and Gann',
  patterns: 'Patterns',
  'forecast-measure': 'Forecasting and measurers',
  shapes: 'Shapes',
  annotations: 'Annotations',
  icons: 'Icons',
};

/** One pickable entry of a family: a drawing tool, a cursor kind or the eraser. `key` is what favourites and last-tool prefs store. */
export interface RailEntry {
  key: string;
  /** The drawing mode id picking it sets (CURSOR for the three cursor kinds). */
  toolId: string;
  label: string;
  group: DrawingGroup;
  section: string;
  cursorKind?: CursorKind;
}

export interface RailSection {
  title: string;
  entries: RailEntry[];
}

export interface RailGroup {
  id: DrawingGroup;
  label: string;
  /** The family's entries in order (the flyout's keyboard order). */
  entries: RailEntry[];
  sections: RailSection[];
}

export const CURSOR_ENTRIES: readonly RailEntry[] = [
  { key: 'cursor.cross', toolId: CURSOR, label: 'Cross', group: 'cursors', section: 'Cursors', cursorKind: 'cross' },
  { key: 'cursor.dot', toolId: CURSOR, label: 'Dot', group: 'cursors', section: 'Cursors', cursorKind: 'dot' },
  { key: 'cursor.arrow', toolId: CURSOR, label: 'Arrow', group: 'cursors', section: 'Cursors', cursorKind: 'arrow' },
  { key: ERASER, toolId: ERASER, label: 'Eraser', group: 'cursors', section: 'Cursors' },
];

function toEntry(t: DrawingTool): RailEntry {
  return { key: t.id, toolId: t.id, label: t.label, group: t.group, section: t.section };
}

/** The visible families: the cursor entries and the registry's tools, by family order then registry order; empty families are left out. */
export function railGroups(tools: readonly DrawingTool[] = TOOLS): RailGroup[] {
  const all: RailEntry[] = [...CURSOR_ENTRIES, ...tools.map(toEntry)];
  const groups: RailGroup[] = [];
  for (const id of GROUP_ORDER) {
    const entries = all.filter((e) => e.group === id);
    if (entries.length === 0) continue;
    const sections: RailSection[] = [];
    for (const e of entries) {
      let s = sections.find((x) => x.title === e.section);
      if (!s) sections.push((s = { title: e.section, entries: [] }));
      s.entries.push(e);
    }
    // the flyout lists section by section, so keyboard order follows it
    groups.push({ id, label: GROUP_LABELS[id], entries: sections.flatMap((s) => s.entries), sections });
  }
  return groups;
}

export function allEntries(groups: readonly RailGroup[] = railGroups()): RailEntry[] {
  return groups.flatMap((g) => g.entries);
}

/** The entry a family's button shows: its last used one, else its first. */
export function groupEntry(group: RailGroup, lastTool: Readonly<Record<string, string>>): RailEntry {
  return group.entries.find((e) => e.key === lastTool[group.id]) ?? group.entries[0];
}

/** Whether the entry is the current mode (a cursor kind only while the cursor mode is on). */
export function entryPressed(e: RailEntry, tool: string, cursorKind: CursorKind): boolean {
  if (e.toolId !== tool) return false;
  return e.cursorKind ? e.cursorKind === cursorKind : true;
}

/** Whether the current mode belongs to the family. */
export function groupPressed(group: RailGroup, tool: string): boolean {
  return group.entries.some((e) => e.toolId === tool);
}

/** The flyout's next focused index for a key (arrows wrap, Home and End jump), or null for any other key. */
export function flyoutStep(index: number, count: number, key: string): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** Stored favourites: strings that are known entry keys, once each, in stored order. */
export function sanitizeFavorites(v: unknown, known: ReadonlySet<string> = new Set(allEntries().map((e) => e.key))): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const k of v) if (typeof k === 'string' && known.has(k) && !out.includes(k)) out.push(k);
  return out;
}

/** Stored last tool per family: kept only when the entry is in that family. */
export function sanitizeLastTool(v: unknown, groups: readonly RailGroup[] = railGroups()): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const g of groups) {
    const k = (v as Record<string, unknown>)[g.id];
    if (typeof k === 'string' && g.entries.some((e) => e.key === k)) out[g.id] = k;
  }
  return out;
}

export function sanitizeCursorKind(v: unknown): CursorKind {
  return CURSOR_KINDS.includes(v as CursorKind) ? (v as CursorKind) : 'cross';
}

export interface BarPos {
  x: number;
  y: number;
}
export const DEFAULT_BAR_POS: BarPos = { x: 56, y: 12 };

export function sanitizeBarPos(v: unknown): BarPos {
  const p = v as Partial<BarPos> | null;
  if (p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y) && (p.x as number) >= 0 && (p.y as number) >= 0) {
    return { x: p.x as number, y: p.y as number };
  }
  return { ...DEFAULT_BAR_POS };
}

/** Keeps a box of size w by h whose top-left is p inside an area of aw by ah. */
export function clampBarPos(p: BarPos, size: { w: number; h: number }, area: { w: number; h: number }): BarPos {
  return {
    x: Math.max(0, Math.min(p.x, Math.max(0, area.w - size.w))),
    y: Math.max(0, Math.min(p.y, Math.max(0, area.h - size.h))),
  };
}
