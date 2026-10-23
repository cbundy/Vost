import { afterEach, describe, expect, it, vi } from 'vitest';
import * as wl from './watchlist';
import type { WatchlistState } from './watchlist';
import type { DataProvider } from './providers/http';

const fakeProviders = [
  { id: 'a', name: 'Alpha', popularSymbols: [{ symbol: 'A1', label: 'One' }, { symbol: 'A2' }] },
  { id: 'b', name: 'Beta', popularSymbols: [{ symbol: 'B1' }] },
] as unknown as DataProvider[];

const base = (): WatchlistState => wl.emptyState();
const lid = (s: WatchlistState) => s.activeListId;
const list = (s: WatchlistState, i = 0) => s.lists[i];
const syms = (sec: { items: { symbol: string }[] }) => sec.items.map((i) => i.symbol);

function stubStorage(initial: Record<string, string> = {}) {
  const store = { ...initial };
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  });
  return store;
}
afterEach(() => vi.unstubAllGlobals());

describe('lists', () => {
  it('creates, renames, activates', () => {
    let s = wl.createList(base(), 'Two');
    expect(s.lists).toHaveLength(2);
    expect(list(s, 1).sections).toHaveLength(1);
    expect(s.activeListId).toBe(list(s, 1).id);
    s = wl.renameList(s, list(s, 1).id, 'X');
    expect(list(s, 1).name).toBe('X');
    s = wl.setActiveList(s, list(s, 0).id);
    expect(s.activeListId).toBe(list(s, 0).id);
  });
  it('refuses to delete the last list and moves active to a neighbour', () => {
    const one = base();
    expect(wl.deleteList(one, lid(one))).toBe(one);
    const two = wl.createList(one, 'Two');
    const after = wl.deleteList(two, two.activeListId);
    expect(after.lists).toHaveLength(1);
    expect(after.activeListId).toBe(list(after).id);
  });
  it('duplicates with new ids and does not mutate', () => {
    let s = wl.addItem(base(), lid(base()), { providerId: 'a', symbol: 'X' });
    s = wl.addItem(s, list(s).id, { providerId: 'a', symbol: 'X' });
    const before = JSON.stringify(s);
    const d = wl.duplicateList(s, list(s).id);
    expect(JSON.stringify(s)).toBe(before);
    expect(list(d, 1).id).not.toBe(list(d, 0).id);
    expect(list(d, 1).sections[0].id).not.toBe(list(d, 0).sections[0].id);
    expect(syms(list(d, 1).sections[0])).toEqual(['X']);
  });
});

describe('sections and items', () => {
  const setup = () => {
    let s = base();
    const L = list(s).id;
    s = wl.addSection(s, L, 'S2');
    const [s1, s2] = list(s).sections;
    s = wl.addItem(s, L, { providerId: 'a', symbol: 'X' }, s1.id);
    s = wl.addItem(s, L, { providerId: 'a', symbol: 'Y' }, s2.id);
    s = wl.addItem(s, L, { providerId: 'a', symbol: 'Z' }, s2.id);
    return { s, L, s1: s1.id, s2: s2.id };
  };
  it('dedupes across sections by provider+symbol', () => {
    const { s, L, s1 } = setup();
    expect(wl.addItem(s, L, { providerId: 'a', symbol: 'Y' }, s1)).toBe(s);
    expect(wl.addItem(s, L, { providerId: 'b', symbol: 'Y' }, s1)).not.toBe(s);
  });
  it('removes items', () => {
    const { s, L } = setup();
    expect(syms(list(wl.removeItem(s, L, 'a', 'X')).sections[0])).toEqual([]);
  });
  it('removing a section keeps its items in the previous one', () => {
    const { s, L, s2 } = setup();
    const r = wl.removeSection(s, L, s2);
    expect(list(r).sections).toHaveLength(1);
    expect(syms(list(r).sections[0])).toEqual(['X', 'Y', 'Z']);
  });
  it('removing the first section moves items to the next; last section is kept', () => {
    const { s, L, s1 } = setup();
    const r = wl.removeSection(s, L, s1);
    expect(syms(list(r).sections[0])).toEqual(['Y', 'Z', 'X']);
    expect(wl.removeSection(r, L, list(r).sections[0].id)).toEqual(r);
  });
  it('renames and moves sections', () => {
    const { s, L, s1, s2 } = setup();
    expect(list(wl.renameSection(s, L, s1, 'N')).sections[0].name).toBe('N');
    expect(list(wl.moveSection(s, L, s2, 0)).sections.map((x) => x.id)).toEqual([s2, s1]);
  });
  it('moves items within and across sections', () => {
    const { s, L, s1, s2 } = setup();
    const within = wl.moveItem(s, L, 'a', 'Z', s2, 0);
    expect(syms(list(within).sections[1])).toEqual(['Z', 'Y']);
    const across = wl.moveItem(s, L, 'a', 'X', s2, 1);
    expect(syms(list(across).sections[0])).toEqual([]);
    expect(syms(list(across).sections[1])).toEqual(['Y', 'X', 'Z']);
    expect(wl.moveItem(s, L, 'a', 'X', 'nope', 0)).toEqual(s);
    expect(s1).toBeTruthy();
  });
});

describe('notes and tags', () => {
  it('sets note and tags; deleteTag strips items; filterByTag', () => {
    let s = base();
    const L = lid(s);
    s = wl.addItem(s, L, { providerId: 'a', symbol: 'X' });
    s = wl.addItem(s, L, { providerId: 'a', symbol: 'Y' });
    s = wl.createTag(s, 'hot', '#f00');
    const t = s.tags[0].id;
    s = wl.renameTag(s, t, 'warm');
    s = wl.setTagColor(s, t, '#0f0');
    expect(s.tags[0]).toMatchObject({ name: 'warm', color: '#0f0' });
    s = wl.setNote(s, L, 'a', 'X', 'hi');
    s = wl.setItemTags(s, L, 'a', 'X', [t, t]);
    expect(list(s).sections[0].items[0]).toMatchObject({ note: 'hi', tags: [t] });
    expect(syms(wl.filterByTag(list(s), t).sections[0])).toEqual(['X']);
    s = wl.deleteTag(s, t);
    expect(s.tags).toEqual([]);
    expect(list(s).sections[0].items[0].tags).toEqual([]);
  });
});

describe('persistence', () => {
  it('seeds one section per provider on empty storage', () => {
    stubStorage();
    const s = wl.loadWatchlists(fakeProviders);
    expect(s.lists).toHaveLength(1);
    expect(s.lists[0].name).toBe('Default');
    expect(s.lists[0].sections.map((x) => x.name)).toEqual(['Alpha', 'Beta']);
    expect(syms(s.lists[0].sections[0])).toEqual(['A1', 'A2']);
    expect(s.lists[0].sections[0].items[0].label).toBe('One');
  });
  it.each([
    ['corrupt JSON', '{nope'],
    ['wrong version', JSON.stringify({ version: 2, activeListId: 'x', lists: [], tags: [] })],
    ['no lists', JSON.stringify({ version: 1, activeListId: 'x', lists: [], tags: [] })],
  ])('seeds on %s', (_n, raw) => {
    stubStorage({ 'vost.watchlists.v1': raw });
    expect(wl.loadWatchlists(fakeProviders).lists[0].sections).toHaveLength(2);
  });
  it('round-trips through save and load', () => {
    const store = stubStorage();
    const s = wl.createList(base(), 'Mine');
    expect(wl.saveWatchlists(s).ok).toBe(true);
    expect(store['vost.watchlists.v1']).toBeTruthy();
    expect(wl.loadWatchlists(fakeProviders)).toEqual(s);
  });
});

describe('import/export', () => {
  const strip = (l: wl.WatchList) => ({
    name: l.name,
    sections: l.sections.map((x) => ({ name: x.name, items: x.items })),
  });
  it('round-trips modulo ids', () => {
    let s = base();
    const L = lid(s);
    s = wl.createTag(s, 'hot', '#f00');
    s = wl.addItem(s, L, { providerId: 'a', symbol: 'X' }, undefined, 5);
    s = wl.setItemTags(s, L, 'a', 'X', [s.tags[0].id]);
    s = wl.setNote(s, L, 'a', 'X', 'n');
    const json = wl.exportList(list(s), s.tags);
    const target = wl.createTag(base(), 'other', '#000');
    const r = wl.importList(json, target);
    if (typeof r === 'string') throw new Error(r);
    const imported = r.lists[r.lists.length - 1];
    expect(imported.id).not.toBe(list(s).id);
    expect(imported.sections[0].id).not.toBe(list(s).sections[0].id);
    const hot = r.tags.find((t) => t.name === 'hot')!;
    expect(r.tags).toHaveLength(2);
    const norm = strip(imported);
    norm.sections[0].items = norm.sections[0].items.map((i) => ({ ...i, tags: i.tags.map(() => 'T') }));
    const orig = strip(list(s));
    orig.sections[0].items = orig.sections[0].items.map((i) => ({ ...i, tags: i.tags.map(() => 'T') }));
    expect(norm).toEqual(orig);
    expect(imported.sections[0].items[0].tags).toEqual([hot.id]);
  });
  it('drops duplicates within the import', () => {
    const item = { providerId: 'a', symbol: 'X', label: 'X', tags: [], note: '', addedAt: 0 };
    const json = JSON.stringify({
      version: 1,
      list: { id: 'l', name: 'D', sections: [{ id: 's', name: '', items: [item, item] }] },
      tags: [],
    });
    const r = wl.importList(json, base());
    if (typeof r === 'string') throw new Error(r);
    expect(r.lists[1].sections[0].items).toHaveLength(1);
  });
  it.each(['{nope', '[]', '{"version":2}', '{"version":1,"list":{"id":"l"}}', 'null'])(
    'returns an error string for invalid input %s',
    (bad) => {
      expect(typeof wl.importList(bad, base())).toBe('string');
    },
  );
});
