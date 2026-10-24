/**
 * Watchlist model: pure, immutable operations plus persistence, seeding and
 * import/export. No UI or store logic lives here.
 */
import { uid } from '../types';
import type { DataProvider } from './providers/http';
import { loadJson, saveJson } from './storage';

export interface WatchItem {
  providerId: string;
  symbol: string;
  label: string;
  tags: string[];
  note: string;
  addedAt: number;
}
export interface WatchSection {
  id: string;
  name: string;
  collapsed?: boolean;
  items: WatchItem[];
}
export interface WatchList {
  id: string;
  name: string;
  sections: WatchSection[];
}
export interface TagDef {
  id: string;
  name: string;
  color: string;
}
export interface WatchlistState {
  version: 1;
  activeListId: string;
  lists: WatchList[];
  tags: TagDef[];
}

export const WATCHLISTS_KEY = 'watchlists.v1';

/* ---------------------------- helpers ----------------------------- */

const newSection = (name = ''): WatchSection => ({ id: uid(), name, items: [] });

const mapList = (s: WatchlistState, listId: string, fn: (l: WatchList) => WatchList): WatchlistState => ({
  ...s,
  lists: s.lists.map((l) => (l.id === listId ? fn(l) : l)),
});

const mapSection = (
  s: WatchlistState,
  listId: string,
  sectionId: string,
  fn: (sec: WatchSection) => WatchSection,
): WatchlistState =>
  mapList(s, listId, (l) => ({ ...l, sections: l.sections.map((sec) => (sec.id === sectionId ? fn(sec) : sec)) }));

const mapItem = (
  s: WatchlistState,
  listId: string,
  providerId: string,
  symbol: string,
  fn: (it: WatchItem) => WatchItem,
): WatchlistState =>
  mapList(s, listId, (l) => ({
    ...l,
    sections: l.sections.map((sec) => ({
      ...sec,
      items: sec.items.map((it) => (it.providerId === providerId && it.symbol === symbol ? fn(it) : it)),
    })),
  }));

const hasItem = (l: WatchList, providerId: string, symbol: string) =>
  l.sections.some((sec) => sec.items.some((it) => it.providerId === providerId && it.symbol === symbol));

export function emptyState(): WatchlistState {
  const list: WatchList = { id: uid(), name: 'Default', sections: [newSection()] };
  return { version: 1, activeListId: list.id, lists: [list], tags: [] };
}

/* ------------------------------ lists ------------------------------ */

export function createList(s: WatchlistState, name: string): WatchlistState {
  const list: WatchList = { id: uid(), name, sections: [newSection()] };
  return { ...s, lists: [...s.lists, list], activeListId: list.id };
}

export function renameList(s: WatchlistState, listId: string, name: string): WatchlistState {
  return mapList(s, listId, (l) => ({ ...l, name }));
}

export function deleteList(s: WatchlistState, listId: string): WatchlistState {
  const idx = s.lists.findIndex((l) => l.id === listId);
  if (idx < 0 || s.lists.length <= 1) return s;
  const lists = s.lists.filter((l) => l.id !== listId);
  const activeListId =
    s.activeListId === listId ? lists[Math.min(idx, lists.length - 1)].id : s.activeListId;
  return { ...s, lists, activeListId };
}

export function duplicateList(s: WatchlistState, listId: string): WatchlistState {
  const src = s.lists.find((l) => l.id === listId);
  if (!src) return s;
  const copy: WatchList = {
    id: uid(),
    name: `${src.name} copy`,
    sections: src.sections.map((sec) => ({
      ...sec,
      id: uid(),
      items: sec.items.map((it) => ({ ...it, tags: [...it.tags] })),
    })),
  };
  return { ...s, lists: [...s.lists, copy], activeListId: copy.id };
}

export function setActiveList(s: WatchlistState, listId: string): WatchlistState {
  return s.lists.some((l) => l.id === listId) ? { ...s, activeListId: listId } : s;
}

/* ----------------------------- sections ---------------------------- */

export function addSection(s: WatchlistState, listId: string, name: string): WatchlistState {
  return mapList(s, listId, (l) => ({ ...l, sections: [...l.sections, newSection(name)] }));
}

export function renameSection(s: WatchlistState, listId: string, sectionId: string, name: string): WatchlistState {
  return mapSection(s, listId, sectionId, (sec) => ({ ...sec, name }));
}

/** Removes a section; its items move to the previous section (or the next one when it was first). A list keeps at least one section. */
export function removeSection(s: WatchlistState, listId: string, sectionId: string): WatchlistState {
  return mapList(s, listId, (l) => {
    const idx = l.sections.findIndex((sec) => sec.id === sectionId);
    if (idx < 0 || l.sections.length <= 1) return l;
    const removed = l.sections[idx];
    const targetIdx = idx > 0 ? idx - 1 : 1;
    const sections = l.sections
      .map((sec, i) => (i === targetIdx ? { ...sec, items: [...sec.items, ...removed.items] } : sec))
      .filter((sec) => sec.id !== sectionId);
    return { ...l, sections };
  });
}

export function moveSection(s: WatchlistState, listId: string, sectionId: string, toIndex: number): WatchlistState {
  return mapList(s, listId, (l) => {
    const from = l.sections.findIndex((sec) => sec.id === sectionId);
    if (from < 0) return l;
    const sections = [...l.sections];
    const [sec] = sections.splice(from, 1);
    sections.splice(Math.max(0, Math.min(toIndex, sections.length)), 0, sec);
    return { ...l, sections };
  });
}

/* ------------------------------ items ------------------------------ */

export function addItem(
  s: WatchlistState,
  listId: string,
  item: { providerId: string; symbol: string; label?: string },
  sectionId?: string,
  now: number = Date.now(),
): WatchlistState {
  const list = s.lists.find((l) => l.id === listId);
  if (!list || hasItem(list, item.providerId, item.symbol)) return s;
  const target = list.sections.find((sec) => sec.id === sectionId) ?? list.sections[0];
  const full: WatchItem = {
    providerId: item.providerId,
    symbol: item.symbol,
    label: item.label ?? item.symbol,
    tags: [],
    note: '',
    addedAt: now,
  };
  return mapSection(s, listId, target.id, (sec) => ({ ...sec, items: [...sec.items, full] }));
}

export function removeItem(s: WatchlistState, listId: string, providerId: string, symbol: string): WatchlistState {
  return mapList(s, listId, (l) => ({
    ...l,
    sections: l.sections.map((sec) => ({
      ...sec,
      items: sec.items.filter((it) => !(it.providerId === providerId && it.symbol === symbol)),
    })),
  }));
}

/** Moves an item to `toIndex` of `toSectionId` (within or across sections). */
export function moveItem(
  s: WatchlistState,
  listId: string,
  providerId: string,
  symbol: string,
  toSectionId: string,
  toIndex: number,
): WatchlistState {
  return mapList(s, listId, (l) => {
    if (!l.sections.some((sec) => sec.id === toSectionId)) return l;
    let moved: WatchItem | undefined;
    const stripped = l.sections.map((sec) => {
      const found = sec.items.find((it) => it.providerId === providerId && it.symbol === symbol);
      if (!found) return sec;
      moved = found;
      return { ...sec, items: sec.items.filter((it) => it !== found) };
    });
    if (!moved) return l;
    const item = moved;
    return {
      ...l,
      sections: stripped.map((sec) => {
        if (sec.id !== toSectionId) return sec;
        const items = [...sec.items];
        items.splice(Math.max(0, Math.min(toIndex, items.length)), 0, item);
        return { ...sec, items };
      }),
    };
  });
}

export function setNote(s: WatchlistState, listId: string, providerId: string, symbol: string, note: string): WatchlistState {
  return mapItem(s, listId, providerId, symbol, (it) => ({ ...it, note }));
}

export function setItemTags(
  s: WatchlistState,
  listId: string,
  providerId: string,
  symbol: string,
  tags: string[],
): WatchlistState {
  return mapItem(s, listId, providerId, symbol, (it) => ({ ...it, tags: [...new Set(tags)] }));
}

/* ------------------------------- tags ------------------------------ */

export function createTag(s: WatchlistState, name: string, color: string): WatchlistState {
  return { ...s, tags: [...s.tags, { id: uid(), name, color }] };
}

export function renameTag(s: WatchlistState, tagId: string, name: string): WatchlistState {
  return { ...s, tags: s.tags.map((t) => (t.id === tagId ? { ...t, name } : t)) };
}

export function setTagColor(s: WatchlistState, tagId: string, color: string): WatchlistState {
  return { ...s, tags: s.tags.map((t) => (t.id === tagId ? { ...t, color } : t)) };
}

export function deleteTag(s: WatchlistState, tagId: string): WatchlistState {
  return {
    ...s,
    tags: s.tags.filter((t) => t.id !== tagId),
    lists: s.lists.map((l) => ({
      ...l,
      sections: l.sections.map((sec) => ({
        ...sec,
        items: sec.items.map((it) => (it.tags.includes(tagId) ? { ...it, tags: it.tags.filter((t) => t !== tagId) } : it)),
      })),
    })),
  };
}

/** Returns a copy of the list keeping only items carrying `tagId` (sections are kept, possibly empty). */
export function filterByTag(list: WatchList, tagId: string): WatchList {
  return {
    ...list,
    sections: list.sections.map((sec) => ({ ...sec, items: sec.items.filter((it) => it.tags.includes(tagId)) })),
  };
}

/* ---------------------------- validation --------------------------- */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function parseItem(v: unknown): WatchItem | null {
  if (!isObj(v) || !isStr(v.providerId) || !isStr(v.symbol) || !v.symbol) return null;
  return {
    providerId: v.providerId,
    symbol: v.symbol,
    label: isStr(v.label) ? v.label : v.symbol,
    tags: Array.isArray(v.tags) ? v.tags.filter(isStr) : [],
    note: isStr(v.note) ? v.note : '',
    addedAt: typeof v.addedAt === 'number' && Number.isFinite(v.addedAt) ? v.addedAt : 0,
  };
}

function parseSection(v: unknown): WatchSection | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !Array.isArray(v.items)) return null;
  const items: WatchItem[] = [];
  for (const raw of v.items) {
    const it = parseItem(raw);
    if (!it) return null;
    items.push(it);
  }
  const sec: WatchSection = { id: v.id, name: v.name, items };
  if (typeof v.collapsed === 'boolean') sec.collapsed = v.collapsed;
  return sec;
}

function parseList(v: unknown): WatchList | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !Array.isArray(v.sections) || v.sections.length === 0) return null;
  const sections: WatchSection[] = [];
  for (const raw of v.sections) {
    const sec = parseSection(raw);
    if (!sec) return null;
    sections.push(sec);
  }
  return { id: v.id, name: v.name, sections };
}

function parseTag(v: unknown): TagDef | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.name) || !isStr(v.color)) return null;
  return { id: v.id, name: v.name, color: v.color };
}

/** Validates an unknown value as a WatchlistState; null when invalid. */
export function parseWatchlistState(v: unknown): WatchlistState | null {
  if (!isObj(v) || v.version !== 1 || !Array.isArray(v.lists) || v.lists.length === 0 || !Array.isArray(v.tags)) return null;
  const lists: WatchList[] = [];
  for (const raw of v.lists) {
    const l = parseList(raw);
    if (!l) return null;
    lists.push(l);
  }
  const tags: TagDef[] = [];
  for (const raw of v.tags) {
    const t = parseTag(raw);
    if (!t) return null;
    tags.push(t);
  }
  const activeListId = isStr(v.activeListId) && lists.some((l) => l.id === v.activeListId) ? v.activeListId : lists[0].id;
  return { version: 1, activeListId, lists, tags };
}

/* --------------------------- persistence --------------------------- */

/** One list "Default" with a section per provider holding its popular symbols. */
export function seedWatchlists(providers: readonly DataProvider[]): WatchlistState {
  const now = Date.now();
  const sections: WatchSection[] = providers.map((p) => ({
    id: uid(),
    name: p.name,
    items: p.popularSymbols.map((sym) => ({
      providerId: p.id,
      symbol: sym.symbol,
      label: sym.label ?? sym.symbol,
      tags: [],
      note: '',
      addedAt: now,
    })),
  }));
  if (sections.length === 0) sections.push(newSection());
  const list: WatchList = { id: uid(), name: 'Default', sections };
  return { version: 1, activeListId: list.id, lists: [list], tags: [] };
}

export function loadWatchlists(providers: readonly DataProvider[]): WatchlistState {
  const stored = parseWatchlistState(loadJson<unknown>(WATCHLISTS_KEY, null));
  return stored ?? seedWatchlists(providers);
}

export function saveWatchlists(s: WatchlistState): { ok: boolean; error?: string } {
  return saveJson(WATCHLISTS_KEY, s);
}

/* -------------------------- import / export ------------------------ */

export function exportList(list: WatchList, tags: TagDef[]): string {
  const used = new Set(list.sections.flatMap((sec) => sec.items.flatMap((it) => it.tags)));
  return JSON.stringify({ version: 1, list, tags: tags.filter((t) => used.has(t.id)) }, null, 2);
}

/** Imports an exported list as a new list. Never throws; returns an error string on invalid input. */
export function importList(json: string, s: WatchlistState): WatchlistState | string {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return 'Invalid JSON';
  }
  if (!isObj(data) || data.version !== 1) return 'Unsupported watchlist version';
  const parsed = parseList(data.list);
  if (!parsed) return 'Invalid watchlist';
  const incomingTags: TagDef[] = [];
  if (data.tags !== undefined) {
    if (!Array.isArray(data.tags)) return 'Invalid tags';
    for (const raw of data.tags) {
      const t = parseTag(raw);
      if (!t) return 'Invalid tags';
      incomingTags.push(t);
    }
  }
  // Merge tags: reuse an existing tag with the same name, otherwise add with a fresh id.
  const tags = [...s.tags];
  const tagMap = new Map<string, string>();
  for (const t of incomingTags) {
    const existing = tags.find((e) => e.name === t.name);
    if (existing) tagMap.set(t.id, existing.id);
    else {
      const id = uid();
      tags.push({ ...t, id });
      tagMap.set(t.id, id);
    }
  }
  const seen = new Set<string>();
  const sections = parsed.sections.map((sec) => ({
    ...sec,
    id: uid(),
    items: sec.items.flatMap((it) => {
      const key = `${it.providerId}\u0000${it.symbol}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const itemTags = [...new Set(it.tags.map((t) => tagMap.get(t)).filter(isStr))];
      return [{ ...it, tags: itemTags }];
    }),
  }));
  const list: WatchList = { id: uid(), name: parsed.name, sections };
  return { ...s, tags, lists: [...s.lists, list], activeListId: list.id };
}
