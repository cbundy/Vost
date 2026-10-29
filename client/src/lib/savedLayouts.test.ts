import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SYNC, evenSizes, getArrangement, LAYOUT_VERSION, type LayoutRecord } from './layouts';
import * as sl from './savedLayouts';
import { stubStorage } from '../state/stateTestKit';

afterEach(() => vi.unstubAllGlobals());

function record(symbol = 'DEMO', timeframe = '1d'): LayoutRecord {
  return {
    version: LAYOUT_VERSION,
    arrangementId: 'single',
    activeChartId: 'chart-1',
    charts: [{ id: 'chart-1', providerId: 'demo', symbol, timeframe, bars: 500, indicators: [], btConfig: {}, showTrades: true }],
    sizes: evenSizes(getArrangement('single')!),
    sync: DEFAULT_SYNC,
  };
}

describe('saved layouts model', () => {
  it('seeds one "Unnamed" layout from the working layout, current, autosave on', () => {
    const s = sl.seedFrom(record(), 100);
    expect(s.layouts).toHaveLength(1);
    expect(s.layouts[0]).toMatchObject({ name: 'Unnamed', createdAt: 100, updatedAt: 100, lastUsedAt: 100, layout: record() });
    expect(s.currentId).toBe(s.layouts[0].id);
    expect(s.autosave).toBe(true);
  });

  it('creates and copies a layout, which becomes current', () => {
    const s0 = sl.seedFrom(record(), 1);
    const s1 = sl.createLayout(s0, '  Swing  ', record('DEMO-BEAR'), 2);
    expect(s1.layouts).toHaveLength(2);
    expect(s1.layouts[1].name).toBe('Swing');
    expect(s1.currentId).toBe(s1.layouts[1].id);
    const s2 = sl.copyLayout(s1, 'Swing copy', record('DEMO-BEAR'), 3);
    expect(s2.layouts.map((l) => l.name)).toEqual(['Unnamed', 'Swing', 'Swing copy']);
    expect(s2.currentId).toBe(s2.layouts[2].id);
    expect(sl.createLayout(s0, '   ', record(), 2)).toBe(s0);
  });

  it('renames with a trimmed, non-empty name of at most 64 characters; names need not be unique', () => {
    const s0 = sl.seedFrom(record(), 1);
    const id = s0.currentId;
    expect(sl.renameLayout(s0, id, '  Long Term ').layouts[0].name).toBe('Long Term');
    expect(sl.renameLayout(s0, id, '   ')).toBe(s0);
    expect(sl.renameLayout(s0, 'nope', 'X')).toBe(s0);
    expect(sl.renameLayout(s0, id, 'x'.repeat(100)).layouts[0].name).toHaveLength(64);
    const dup = sl.createLayout(s0, 'Unnamed', record(), 2);
    expect(dup.layouts.map((l) => l.name)).toEqual(['Unnamed', 'Unnamed']);
  });

  it('refuses to delete the current layout', () => {
    const s1 = sl.createLayout(sl.seedFrom(record(), 1), 'B', record(), 2);
    expect(sl.deleteLayout(s1, s1.currentId)).toBe(s1);
    const other = s1.layouts[0].id;
    expect(sl.deleteLayout(s1, other).layouts.map((l) => l.name)).toEqual(['B']);
  });

  it('lists the recent layouts without the current one, newest first, at most five', () => {
    let s = sl.seedFrom(record(), 1);
    for (let i = 2; i <= 8; i++) s = sl.createLayout(s, `L${i}`, record(), i);
    const rec = sl.recent(s);
    expect(rec.map((l) => l.name)).toEqual(['L7', 'L6', 'L5', 'L4', 'L3']);
    expect(rec.some((l) => l.id === s.currentId)).toBe(false);
    s = sl.setCurrent(s, s.layouts[0].id, 50);
    expect(sl.recent(s)[0].name).toBe('L8');
    expect(sl.currentEntry(s)!.lastUsedAt).toBe(50);
  });

  it('searches by name, any case', () => {
    let s = sl.seedFrom(record(), 1);
    s = sl.createLayout(s, 'Long Term', record(), 2);
    s = sl.createLayout(s, 'Scalping', record(), 3);
    expect(sl.search(s, 'LONG').map((l) => l.name)).toEqual(['Long Term']);
    expect(sl.search(s, '')).toHaveLength(3);
    expect(sl.search(s, 'zzz')).toEqual([]);
  });

  it('tells unsaved changes from a saved layout', () => {
    const s = sl.seedFrom(record(), 1);
    const cur = sl.currentEntry(s);
    expect(sl.isDirty(cur, record())).toBe(false);
    expect(sl.isDirty(cur, record('DEMO-BEAR'))).toBe(true);
    const saved = sl.writeSnapshot(s, s.currentId, record('DEMO-BEAR'), 9);
    expect(sl.isDirty(sl.currentEntry(saved), record('DEMO-BEAR'))).toBe(false);
    expect(sl.currentEntry(saved)!.updatedAt).toBe(9);
  });

  it('names the active chart market for the lists', () => {
    expect(sl.activeMarket(record('BTCUSDT', '1W'))).toBe('BTCUSDT, 1W');
  });
});

describe('parsing the stored layouts', () => {
  it('drops an entry whose layout is unusable and falls back to the latest used when the current is missing', () => {
    const good = (id: string, lastUsedAt: number) => ({ id, name: id, createdAt: 1, updatedAt: 1, lastUsedAt, layout: record() });
    const parsed = sl.parseSavedLayouts({
      version: 1,
      currentId: 'gone',
      autosave: false,
      layouts: [good('a', 5), { ...good('bad', 9), layout: { version: 2 } }, good('c', 7), 'junk', { ...good('d', 1), name: '  ' }],
    });
    expect(parsed!.layouts.map((l) => l.id)).toEqual(['a', 'c']);
    expect(parsed!.currentId).toBe('c');
    expect(parsed!.autosave).toBe(false);
  });

  it('gives null for another version, junk, or no usable entry', () => {
    expect(sl.parseSavedLayouts(null)).toBeNull();
    expect(sl.parseSavedLayouts({ version: 2, layouts: [] })).toBeNull();
    expect(sl.parseSavedLayouts({ version: 1, layouts: [{ id: 'x', name: 'x', layout: {} }] })).toBeNull();
  });

  describe('with the browser storage', () => {
    beforeEach(() => stubStorage());

    it('a corrupt key reads as nothing and touches no other key', () => {
      localStorage.setItem('vost.savedLayouts.v1', '{not json');
      localStorage.setItem('vost.layout.v1', 'L');
      localStorage.setItem('vost.prefs.v1', 'P');
      localStorage.setItem('vost.watchlists.v1', 'W');
      expect(sl.loadSavedLayouts()).toBeNull();
      expect(['layout.v1', 'prefs.v1', 'watchlists.v1'].map((k) => localStorage.getItem(`vost.${k}`))).toEqual(['L', 'P', 'W']);
    });

    it('saves and loads a state', () => {
      const s = sl.seedFrom(record(), 1);
      sl.saveSavedLayouts(s);
      expect(sl.loadSavedLayouts()).toEqual(s);
    });
  });
});
