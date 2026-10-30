import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HISTORY_LIMIT,
  createDrawingsStorage,
  STORAGE_KEY,
  LEGACY_KEY_V1,
  STORAGE_VERSION,
  setStyle,
  previewPatch,
  add,
  commit,
  emptyState,
  loadDrawings,
  parseStore,
  preview,
  redo,
  remove,
  removeAll,
  saveDrawings,
  setText,
  sourceKey,
  undo,
  update,
  type Drawing,
  setLocked,
  setHidden,
  moveTo,
  rename,
  reorder,
  reorderMany,
  previewMany,
  cloneMany,
  imageKeys,
  persistedImageKeys,
  stateImageKeys,
  paste,
  removeMany,
  setCell,
  setCells,
} from './drawings';
import { withStyleValue } from './toolbarPickers';
import { VALIDATORS } from '../components/chart/tools';

const COUNTS = { trendLine: 2, horizontalLine: 1, ray: 2, rectangle: 2, fibRetracement: 2, fibTimeZone: 2, fibSpeedFan: 2, fibCircles: 2, fibSpiral: 2, fibSpeedArcs: 2, gannBox: 2, gannSquareFixed: 2, gannSquare: 2, gannFan: 2, text: 1 };
const TEXT = new Set(['text']);
const TRANSIENT = new Set(['measure']);
const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

const trend = (id: string, p = 10): Drawing => ({
  id,
  tool: 'trendLine',
  anchors: [
    { time: 100, price: p },
    { time: 200, price: p + 5 },
  ],
});
const hline = (id: string): Drawing => ({ id, tool: 'horizontalLine', anchors: [{ time: 100, price: 7 }] });

describe('edits and history', () => {
  it('adds, updates and removes', () => {
    let s = add(emptyState(), trend('a'));
    s = add(s, hline('b'));
    expect(s.drawings.map((d) => d.id)).toEqual(['a', 'b']);
    s = update(s, 'a', [{ time: 1, price: 2 }, { time: 3, price: 4 }]);
    expect(s.drawings[0].anchors[0]).toEqual({ time: 1, price: 2 });
    s = remove(s, 'b');
    expect(s.drawings.map((d) => d.id)).toEqual(['a']);
  });
  it('moves one anchor or the whole drawing as one step', () => {
    let s = add(emptyState(), trend('a'));
    s = update(s, 'a', [{ time: 100, price: 10 }, { time: 250, price: 20 }]);
    expect(s.drawings[0].anchors[1]).toEqual({ time: 250, price: 20 });
    s = update(s, 'a', [{ time: 150, price: 15 }, { time: 300, price: 25 }]);
    expect(s.drawings[0].anchors).toEqual([{ time: 150, price: 15 }, { time: 300, price: 25 }]);
    expect(s.past).toHaveLength(3);
  });
  it('erasing a drawing is one undo step that undo brings back in place', () => {
    let s = add(add(add(emptyState(), trend('a')), hline('b')), trend('c'));
    const before = s.past.length;
    s = remove(s, 'b');
    expect(s.past).toHaveLength(before + 1);
    expect(s.drawings.map((d) => d.id)).toEqual(['a', 'c']);
    s = undo(s);
    expect(s.drawings.map((d) => d.id)).toEqual(['a', 'b', 'c']);
  });
  it('undoes and redoes in order', () => {
    let s = add(emptyState(), trend('a'));
    s = add(s, hline('b'));
    s = remove(s, 'a');
    s = undo(s);
    expect(s.drawings.map((d) => d.id)).toEqual(['a', 'b']);
    s = undo(s);
    expect(s.drawings.map((d) => d.id)).toEqual(['a']);
    s = redo(s);
    expect(s.drawings.map((d) => d.id)).toEqual(['a', 'b']);
    s = redo(s);
    expect(s.drawings.map((d) => d.id)).toEqual(['b']);
    expect(redo(s)).toBe(s);
  });
  it('undo with nothing to undo is a no-op', () => {
    const s = emptyState();
    expect(undo(s)).toBe(s);
  });
  it('clears redo on a new edit', () => {
    let s = add(emptyState(), trend('a'));
    s = undo(s);
    expect(s.future).toHaveLength(1);
    s = add(s, hline('b'));
    expect(s.future).toHaveLength(0);
  });
  it('caps history at 100 steps', () => {
    let s = emptyState();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s = add(s, hline(`h${i}`));
    expect(s.past).toHaveLength(HISTORY_LIMIT);
    for (let i = 0; i < 500; i++) s = undo(s);
    expect(s.drawings).toHaveLength(20);
  });
  it('a drag is one step: preview does not touch history, commit records the start', () => {
    let s = add(emptyState(), trend('a'));
    const before = s.drawings;
    s = preview(s, 'a', [{ time: 101, price: 11 }, { time: 201, price: 16 }]);
    s = preview(s, 'a', [{ time: 150, price: 20 }, { time: 250, price: 25 }]);
    expect(s.past).toHaveLength(1);
    s = commit(s, before);
    expect(s.past).toHaveLength(2);
    s = undo(s);
    expect(s.drawings).toEqual(before);
  });
  it('commit of an unchanged drag records nothing', () => {
    const s0 = add(emptyState(), trend('a'));
    const s = commit(preview(s0, 'a', s0.drawings[0].anchors), s0.drawings);
    expect(s.past).toHaveLength(1);
  });
});

describe('source key', () => {
  it('uses provider and symbol, or the local dataset', () => {
    expect(sourceKey({ providerId: 'binance', symbol: 'BTCUSDT', activeDatasetId: null })).toBe('binance:BTCUSDT');
    expect(sourceKey({ providerId: 'binance', symbol: 'BTCUSDT', activeDatasetId: 'ds_1' })).toBe('local:ds_1');
  });
});

describe('storage', () => {
  it('round trips', () => {
    saveDrawings({ 'demo:DEMO': [trend('a'), hline('b')], 'local:x': [] });
    const got = loadDrawings(COUNTS);
    expect(got.sources).toEqual({ 'demo:DEMO': [trend('a'), hline('b')] });
    expect(JSON.parse(store.get('vost.' + STORAGE_KEY)!).version).toBe(2);
  });
  it('loads none when missing, unparsable or the wrong shape', () => {
    expect(loadDrawings(COUNTS).sources).toEqual({});
    store.set('vost.' + STORAGE_KEY, '{nope');
    expect(loadDrawings(COUNTS).sources).toEqual({});
    for (const bad of [null, 5, [], { version: 2 }, { version: 2, sources: [] }, { version: 'x', sources: {} }, { sources: {} }]) {
      expect(parseStore(bad, COUNTS)).toEqual({ sources: {}, newer: false });
    }
  });
  it('drops a bad item alone (an unknown tool, even one named like an object method, is kept as stored)', () => {
    const raw = {
      version: 2,
      sources: {
        s: [
          trend('a'),
          { id: 'n', tool: 'trendLine', anchors: [{ time: 1, price: NaN }, { time: 2, price: 2 }] },
          { id: 'c', tool: 'trendLine', anchors: [{ time: 1, price: 1 }] },
          { id: 'p', tool: 'toString', anchors: [] },
          'junk',
          hline('b'),
        ],
        t: 'not a list',
      },
    };
    expect(parseStore(JSON.parse(JSON.stringify(raw)), COUNTS).sources).toEqual({ s: [trend('a'), { id: 'p', tool: 'toString', anchors: [] }, hline('b')] });
  });
  it('keeps ray, rectangle, the fibonacci and the gann tools with 2 anchors and drops other counts', () => {
    const an = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i + 1, price: i + 1 }));
    const two = ['ray', 'rectangle', 'fibRetracement', 'fibTimeZone', 'fibSpeedFan', 'fibCircles', 'fibSpiral', 'fibSpeedArcs', 'gannBox', 'gannSquareFixed', 'gannSquare', 'gannFan'];
    const ok = two.map((tool) => ({ id: tool, tool, anchors: an(2) }));
    const bad = two.flatMap((tool) => [1, 3].map((n) => ({ id: `${tool}${n}`, tool, anchors: an(n) })));
    expect(parseStore({ version: 1, sources: { s: [...ok, ...bad] } }, COUNTS).sources).toEqual({ s: ok });
  });
  it('loads a payload saved before the new tools unchanged', () => {
    const saved = { version: 1, sources: { s: [trend('a'), hline('b')] } };
    store.set('vost.' + STORAGE_KEY, JSON.stringify(saved));
    expect(loadDrawings({ trendLine: 2, horizontalLine: 1 }).sources).toEqual(saved.sources);
    expect(loadDrawings(COUNTS).sources).toEqual(saved.sources);
  });
  it('round trips a text drawing and trims and cuts its text', () => {
    const note = (id: string, text: unknown) => ({ id, tool: 'text', anchors: [{ time: 5, price: 6 }], text });
    saveDrawings({ s: [note('a', 'hello') as Drawing] });
    expect(loadDrawings(COUNTS, TEXT).sources).toEqual({ s: [note('a', 'hello')] });
    const got = parseStore({ version: 1, sources: { s: [note('b', `  ${'x'.repeat(600)}  `), note('c', '  hi  ')] } }, COUNTS, TEXT);
    expect(got.sources.s.map((d) => d.text)).toEqual(['x'.repeat(500), 'hi']);
  });
  it('round trips multi-line text of text and anchored text tools, and loads an old text drawing unchanged', () => {
    const counts = { ...COUNTS, anchoredText: 1 };
    const tools = new Set(['text', 'anchoredText']);
    const panes = new Set(['anchoredText']);
    const old = { id: 'o', tool: 'text', anchors: [{ time: 5, price: 6 }], text: 'old note' };
    const multi = { id: 'm', tool: 'text', anchors: [{ time: 5, price: 6 }], text: 'a\nb\n\nc', style: { align: 'center', wrap: false } };
    const pane = { id: 'p', tool: 'anchoredText', anchors: [{ time: 0.25, price: 0.5 }], text: 'x\ny' };
    saveDrawings({ s: [old, multi, pane] });
    expect(loadDrawings(counts, tools, TRANSIENT, panes).sources).toEqual({ s: [old, multi, pane] });
  });
  it('round trips the note tools with their text and style, drops a 1-anchor callout and clamps an anchored note', () => {
    const counts = { ...COUNTS, note: 1, anchoredNote: 1, callout: 2, comment: 1 };
    const tools = new Set(['text', 'note', 'anchoredNote', 'callout', 'comment']);
    const panes = new Set(['anchoredNote']);
    const a = { time: 5, price: 6 };
    const list = [
      { id: 'n', tool: 'note', anchors: [a], text: 'pin\ntext', style: { markerColor: '#ff0000' } },
      { id: 'p', tool: 'anchoredNote', anchors: [{ time: 0.25, price: 0.5 }], text: 'fixed' },
      { id: 'c', tool: 'callout', anchors: [a, { time: 9, price: 1 }], text: 'box', style: { backgroundOpacity: 0.5 } },
      { id: 'm', tool: 'comment', anchors: [a], text: 'bubble', style: { wrap: false } },
    ];
    saveDrawings({ s: list });
    expect(loadDrawings(counts, tools, TRANSIENT, panes).sources).toEqual({ s: list });
    const raw = {
      version: 2,
      sources: { s: [{ id: 'x', tool: 'callout', anchors: [a], text: 'one' }, { id: 'y', tool: 'anchoredNote', anchors: [{ time: -2, price: 3 }], text: 'hi' }, { id: 'z', tool: 'note', anchors: [a], text: '  ' }] },
    };
    const got = parseStore(raw, counts, tools, TRANSIENT, panes).sources.s;
    expect(got.map((d) => d.id)).toEqual(['y']);
    expect(got[0].anchors).toEqual([{ time: 0, price: 1 }]);
  });
  it('round trips the price markers with text and style and drops a 1-anchor price note', () => {
    const counts = { ...COUNTS, priceNote: 2, priceLabel: 1, signpost: 1, flagMark: 1 };
    const tools = new Set(['text']);
    const caps = new Set(['priceNote', 'signpost']);
    const a = { time: 5, price: 6 };
    const list = [
      { id: 'n', tool: 'priceNote', anchors: [a, { time: 9, price: 1 }], text: 'target', style: { color: '#ff0000' } },
      { id: 'l', tool: 'priceLabel', anchors: [a] },
      { id: 's', tool: 'signpost', anchors: [a], text: 'sign', style: { position: 'below', emoji: '🚀' } },
      { id: 'f', tool: 'flagMark', anchors: [a], style: { color: '#00ff00' } },
    ];
    saveDrawings({ s: list });
    expect(loadDrawings(counts, tools, TRANSIENT, new Set(), caps).sources).toEqual({ s: list });
    const raw = { version: 2, sources: { s: [{ id: 'x', tool: 'priceNote', anchors: [a] }, list[1]] } };
    expect(parseStore(raw, counts, tools, TRANSIENT, new Set(), caps).sources.s.map((d) => d.id)).toEqual(['l']);
  });
  it('clamps a pane-anchored anchor onto 0..1 and leaves other tools alone', () => {
    const counts = { ...COUNTS, anchoredText: 1 };
    const tools = new Set(['text', 'anchoredText']);
    const panes = new Set(['anchoredText']);
    const raw = {
      version: 2,
      sources: { s: [{ id: 'p', tool: 'anchoredText', anchors: [{ time: -3, price: 1.7 }], text: 'hi' }, { id: 't', tool: 'text', anchors: [{ time: -3, price: 1.7 }], text: 'hi' }] },
    };
    const got = parseStore(raw, counts, tools, TRANSIENT, panes).sources.s;
    expect(got[0].anchors).toEqual([{ time: 0, price: 1 }]);
    expect(got[1].anchors).toEqual([{ time: -3, price: 1.7 }]);
  });
  it('drops a text drawing with missing, numeric or blank text and keeps its neighbours', () => {
    const anchors = [{ time: 5, price: 6 }];
    const raw = { version: 1, sources: { s: [trend('a'), { id: 'm', tool: 'text', anchors }, { id: 'n', tool: 'text', anchors, text: 5 }, { id: 'b', tool: 'text', anchors, text: '   ' }, hline('z')] } };
    expect(parseStore(raw, COUNTS, TEXT).sources).toEqual({ s: [trend('a'), hline('z')] });
  });
  it('keeps text only on text tools', () => {
    const raw = { version: 1, sources: { s: [{ ...trend('a'), text: 'nope' }] } };
    expect(parseStore(raw, COUNTS, TEXT).sources).toEqual({ s: [trend('a')] });
  });
  it('drops a stored measure drawing', () => {
    const measure = { id: 'm', tool: 'measure', anchors: [{ time: 1, price: 1 }, { time: 2, price: 2 }] };
    expect(parseStore({ version: 2, sources: { s: [measure, trend('a')] } }, COUNTS, TEXT, TRANSIENT).sources).toEqual({ s: [trend('a')] });
  });
  it('treats a newer version as none and leaves it in storage until the user saves', () => {
    const newer = JSON.stringify({ version: STORAGE_VERSION + 1, sources: { s: [trend('a')] } });
    store.set('vost.' + STORAGE_KEY, newer);
    const got = loadDrawings(COUNTS);
    expect(got).toEqual({ sources: {}, newer: true });
    expect(store.get('vost.' + STORAGE_KEY)).toBe(newer);
    saveDrawings({ s: [hline('z')] });
    expect(JSON.parse(store.get('vost.' + STORAGE_KEY)!).version).toBe(2);
  });
});

describe('storage version 2', () => {
  const v1 = { version: 1, sources: { s: [trend('a'), hline('b'), { id: 'n', tool: 'text', anchors: [{ time: 5, price: 6 }], text: 'hi' }] } };
  it('migrates a v1 payload without loss and leaves the v1 key as it is', () => {
    const raw = JSON.stringify(v1);
    store.set('vost.' + LEGACY_KEY_V1, raw);
    expect(loadDrawings(COUNTS, TEXT, TRANSIENT).sources).toEqual(v1.sources);
    expect(store.get('vost.' + LEGACY_KEY_V1)).toBe(raw);
    expect(store.has('vost.' + STORAGE_KEY)).toBe(false);
    saveDrawings(v1.sources as never);
    expect(JSON.parse(store.get('vost.' + STORAGE_KEY)!)).toEqual({ ...v1, version: 2 });
    expect(store.get('vost.' + LEGACY_KEY_V1)).toBe(raw);
  });
  it('reads v2 in preference to v1 once it exists', () => {
    store.set('vost.' + LEGACY_KEY_V1, JSON.stringify(v1));
    store.set('vost.' + STORAGE_KEY, JSON.stringify({ version: 2, sources: { s: [hline('only')] } }));
    expect(loadDrawings(COUNTS, TEXT, TRANSIENT).sources).toEqual({ s: [hline('only')] });
  });
  it('keeps an unknown tool and unknown fields (top-level and in style) through load and save', () => {
    const payload = {
      version: 2,
      sources: {
        s: [
          { id: 'u', tool: 'pitchfork', anchors: [{ time: 1, price: 1 }, { time: 2, price: 2 }, { time: 3, price: 3 }], style: { color: 'red', future: [1, 2] }, extra: { deep: true } },
          { ...trend('k'), style: { color: 'accent', futureKey: 'x' }, group: 'g1', locked: true },
          { id: 'n', tool: 'text', anchors: [{ time: 5, price: 6 }], text: 'hi', style: { size: 20, other: 1 }, z: 3 },
        ],
      },
    };
    store.set('vost.' + STORAGE_KEY, JSON.stringify(payload));
    const got = loadDrawings(COUNTS, TEXT, TRANSIENT);
    expect(got.sources).toEqual(payload.sources);
    saveDrawings(got.sources);
    expect(JSON.parse(store.get('vost.' + STORAGE_KEY)!)).toEqual(payload);
  });
  it('keeps an unknown tool whose anchors are not understood, but not one without an id', () => {
    const odd = { id: 'u', tool: 'future', anchors: 'many', note: 1 };
    const got = parseStore({ version: 2, sources: { s: [odd, { tool: 'future' }, trend('a')] } }, COUNTS, TEXT, TRANSIENT);
    expect(got.sources.s).toEqual([odd, trend('a')]);
  });
  it('drops a known tool bad drawing alone, and keeps a bad style out of the drawing', () => {
    const got = parseStore(
      { version: 2, sources: { s: [{ ...trend('a'), style: 'nope' }, { ...trend('b'), anchors: [{ time: 1, price: 'x' }, { time: 2, price: 2 }] }, { id: 't', tool: 'text', anchors: [{ time: 1, price: 1 }], text: ' ' }, hline('z')] } },
      COUNTS,
      TEXT,
      TRANSIENT,
    );
    expect(got.sources).toEqual({ s: [trend('a'), hline('z')] });
  });
});

describe('setStyle', () => {
  it('is one undo step; undo and redo restore it', () => {
    const s0 = add(emptyState(), trend('a'));
    const s1 = setStyle(s0, 'a', { color: '#ff0000', width: 3 });
    expect(s1.drawings[0].style).toEqual({ color: '#ff0000', width: 3 });
    expect(s1.past).toHaveLength(2);
    const u = undo(s1);
    expect(u.drawings[0].style).toBeUndefined();
    expect(redo(u).drawings[0].style).toEqual({ color: '#ff0000', width: 3 });
  });
  it('is the same state when nothing changed or the drawing is unknown', () => {
    const s1 = setStyle(add(emptyState(), trend('a')), 'a', { width: 3 });
    expect(setStyle(s1, 'a', { width: 3 })).toBe(s1);
    expect(setStyle(s1, 'zz', { width: 4 })).toBe(s1);
    const plain = add(emptyState(), trend('a'));
    expect(setStyle(plain, 'a', {})).toBe(plain);
    expect(setStyle(plain, 'a', undefined)).toBe(plain);
  });
  it('a quick edit keeps the other keys, is one undo step, works on a locked drawing and is a no-op when unchanged', () => {
    const s0 = setLocked(setStyle(add(emptyState(), trend('a')), 'a', { width: 3, lineStyle: 'dashed' }), ['a'], true);
    const s1 = setStyle(s0, 'a', withStyleValue(s0.drawings[0].style, 'color', 'red'));
    expect(s1.drawings[0].style).toEqual({ width: 3, lineStyle: 'dashed', color: 'red' });
    expect(s1.drawings[0].locked).toBe(true);
    expect(s1.past).toHaveLength(s0.past.length + 1);
    expect(undo(s1).drawings[0].style).toEqual({ width: 3, lineStyle: 'dashed' });
    expect(setStyle(s1, 'a', withStyleValue(s1.drawings[0].style, 'color', 'red'))).toBe(s1);
  });
  it('clears the style with an empty one', () => {
    const s1 = setStyle(add(emptyState(), trend('a')), 'a', { width: 3 });
    expect('style' in setStyle(s1, 'a', {}).drawings[0]).toBe(false);
  });
  it('previewPatch changes anchors, text and style without history, and commit makes one step', () => {
    const s0 = add(emptyState(), { id: 'n', tool: 'text', anchors: [{ time: 1, price: 1 }], text: 'a' });
    const before = s0.drawings;
    let s = previewPatch(s0, 'n', { style: { size: 20 } });
    s = previewPatch(s, 'n', { anchors: [{ time: 2, price: 3 }], text: 'b', style: { size: 20 } });
    expect(s.past).toHaveLength(1);
    expect(s.drawings[0]).toEqual({ id: 'n', tool: 'text', anchors: [{ time: 2, price: 3 }], text: 'b', style: { size: 20 } });
    s = commit(s, before);
    expect(s.past).toHaveLength(2);
    expect(undo(s).drawings).toEqual(before);
  });
});

describe('removeAll', () => {
  const a: Drawing = { id: 'a', tool: 'horizontalLine', anchors: [{ time: 1, price: 1 }] };
  const b: Drawing = { id: 'b', tool: 'horizontalLine', anchors: [{ time: 2, price: 2 }] };
  it('clears every drawing as one undo step', () => {
    const s = add(add(emptyState(), a), b);
    const cleared = removeAll(s);
    expect(cleared.drawings).toEqual([]);
    const back = undo(cleared);
    expect(back.drawings.map((d) => d.id)).toEqual(['a', 'b']);
    expect(redo(back).drawings).toEqual([]);
  });
  it('returns the same state when there is nothing to remove', () => {
    const s = emptyState();
    expect(removeAll(s)).toBe(s);
  });
});

describe('setText', () => {
  const note: Drawing = { id: 'n', tool: 'text', anchors: [{ time: 1, price: 2 }], text: 'old' };
  it('is one undo step and keeps the text across update', () => {
    const s0 = emptyState([note]);
    const s1 = setText(s0, 'n', '  new ');
    expect(s1.drawings[0].text).toBe('new');
    expect(s1.past).toHaveLength(1);
    expect(undo(s1).drawings[0].text).toBe('old');
    expect(update(s1, 'n', [{ time: 3, price: 4 }]).drawings[0].text).toBe('new');
  });
  it('adds no step when unchanged or when the id is unknown', () => {
    const s0 = emptyState([note]);
    expect(setText(s0, 'n', ' old ')).toBe(s0);
    expect(setText(s0, 'zz', 'x')).toBe(s0);
  });
});

describe('the shared drawings storage (several charts on one page)', () => {
  const mk = () => createDrawingsStorage(() => loadDrawings(COUNTS, TEXT).sources, saveDrawings, 400);
  const saved = () => loadDrawings(COUNTS, TEXT).sources;
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('two charts on different sources lose nothing: the saved payload holds both', () => {
    const shared = mk();
    shared.set('binance:BTCUSDT', [trend('a')]);
    shared.set('demo:DEMO', [hline('b')]);
    vi.advanceTimersByTime(500);
    expect(Object.keys(saved()).sort()).toEqual(['binance:BTCUSDT', 'demo:DEMO']);
  });

  it('why one storage per page: separate copies (one per chart) overwrite each other', () => {
    const chartA = mk();
    const chartB = mk();
    chartA.get('binance:BTCUSDT'); // both read the stored map before either edits
    chartB.get('demo:DEMO');
    chartA.set('binance:BTCUSDT', [trend('a')]);
    chartB.set('demo:DEMO', [hline('b')]);
    vi.advanceTimersByTime(500);
    expect(Object.keys(saved())).toEqual(['demo:DEMO']); // chart A's drawing is gone
  });

  it('tells a chart on the same source about the other chart edit', () => {
    const shared = mk();
    const seenByB: string[] = [];
    shared.subscribe((key) => seenByB.push(`${key}:${shared.get(key).map((d) => d.id).join(',')}`));
    shared.set('demo:DEMO', [trend('a')]);
    shared.set('demo:DEMO', [trend('a'), hline('b')]);
    expect(seenByB).toEqual(['demo:DEMO:a', 'demo:DEMO:a,b']);
  });

  it('stops telling an unsubscribed listener', () => {
    const shared = mk();
    const seen: string[] = [];
    const off = shared.subscribe((k) => seen.push(k));
    shared.set('x', [trend('a')]);
    off();
    shared.set('x', [trend('b')]);
    expect(seen).toEqual(['x']);
  });

  it('a single chart still persists and reloads', () => {
    const only = mk();
    only.set('demo:DEMO', [trend('a')]);
    only.flush();
    expect(saved()['demo:DEMO'].map((d) => d.id)).toEqual(['a']);
    expect(mk().get('demo:DEMO').map((d) => d.id)).toEqual(['a']);
    expect(mk().get('other')).toEqual([]);
  });

  it('keeps what was stored before for sources nobody touched', () => {
    saveDrawings({ 'old:SYM': [trend('o')] });
    const shared = mk();
    shared.set('demo:DEMO', [hline('b')]);
    shared.flush();
    expect(Object.keys(saved()).sort()).toEqual(['demo:DEMO', 'old:SYM']);
  });
});

describe('the line tools', () => {
  it('keeps each new tool id with its own anchor count and drops a wrong one', async () => {
    const { ANCHOR_COUNTS } = await import('../components/chart/tools');
    const an = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i + 1, price: i + 1 }));
    const ids = ['infoLine', 'extendedLine', 'trendAngle', 'horizontalRay', 'verticalLine', 'crossLine'];
    const ok = ids.map((tool) => ({ id: tool, tool, anchors: an(ANCHOR_COUNTS[tool] as number) }));
    const bad = ids.map((tool) => ({ id: `${tool}-bad`, tool, anchors: an(ANCHOR_COUNTS[tool] === 1 ? 2 : 1) }));
    expect(ids.map((t) => ANCHOR_COUNTS[t])).toEqual([2, 2, 2, 1, 1, 1]);
    expect(parseStore({ version: 2, sources: { s: [...ok, ...bad] } }, ANCHOR_COUNTS).sources).toEqual({ s: ok });
  });
});

describe('the channel tools', () => {
  it('round trips each with three (regression: two) anchors and drops a wrong count', async () => {
    const { ANCHOR_COUNTS } = await import('../components/chart/tools');
    const an = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i + 1, price: i + 1 }));
    const ids = ['parallelChannel', 'regressionTrend', 'flatTopBottom', 'disjointChannel'];
    expect(ids.map((t) => ANCHOR_COUNTS[t])).toEqual([3, 2, 3, 3]);
    const ok = ids.map((tool) => ({ id: tool, tool, anchors: an(ANCHOR_COUNTS[tool] as number) }));
    const bad = ids.map((tool) => ({ id: `${tool}-bad`, tool, anchors: an(ANCHOR_COUNTS[tool] === 3 ? 2 : 3) }));
    expect(parseStore({ version: 2, sources: { s: [...ok, ...bad] } }, ANCHOR_COUNTS).sources).toEqual({ s: ok });
  });
});

describe('the pattern tools', () => {
  it('round trips each with its own anchor count and drops a wrong count', async () => {
    const { ANCHOR_COUNTS } = await import('../components/chart/tools');
    const an = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i + 1, price: i + 1 }));
    const ids = ['xabcdPattern', 'cypherPattern', 'abcdPattern', 'headAndShoulders', 'trianglePattern', 'threeDrives', 'elliottImpulse', 'elliottCorrection', 'elliottTriangle', 'elliottDoubleCombo', 'elliottTripleCombo'];
    expect(ids.map((t) => ANCHOR_COUNTS[t])).toEqual([5, 5, 4, 7, 4, 7, 6, 4, 6, 4, 6]);
    const ok = ids.map((tool) => ({ id: tool, tool, anchors: an(ANCHOR_COUNTS[tool] as number) }));
    const bad = ids.map((tool) => ({ id: `${tool}-bad`, tool, anchors: an((ANCHOR_COUNTS[tool] as number) - 1) }));
    expect(parseStore({ version: 2, sources: { s: [...ok, ...bad] } }, ANCHOR_COUNTS).sources).toEqual({ s: ok });
  });
});

describe('the position tools', () => {
  it('round trips both with three anchors, drops a wrong count and a wrong side', async () => {
    const { ANCHOR_COUNTS } = await import('../components/chart/tools');
    const ids = ['longPosition', 'shortPosition'];
    expect(ids.map((t) => ANCHOR_COUNTS[t])).toEqual([3, 3]);
    const an = (e: number, t: number, s: number) => [{ time: 1, price: e }, { time: 2, price: t }, { time: 2, price: s }];
    const ok = [{ id: 'l', tool: 'longPosition', anchors: an(10, 12, 9) }, { id: 's', tool: 'shortPosition', anchors: an(10, 8, 11) }];
    const bad = [
      { id: 'l2', tool: 'longPosition', anchors: [{ time: 1, price: 1 }, { time: 2, price: 2 }] },
      { id: 'l3', tool: 'longPosition', anchors: an(10, 8, 11) },
      { id: 's2', tool: 'shortPosition', anchors: an(10, 12, 9) },
    ];
    expect(parseStore({ version: 2, sources: { s: [...ok, ...bad] } }, ANCHOR_COUNTS, undefined, undefined, undefined, undefined, VALIDATORS).sources).toEqual({ s: ok });
  });
});

describe('the forecast tools', () => {
  it('round trips Forecast with two anchors and Projection with three, drops a wrong count and a non-finite anchor', async () => {
    const { ANCHOR_COUNTS } = await import('../components/chart/tools');
    expect(['forecast', 'projection'].map((t) => ANCHOR_COUNTS[t])).toEqual([2, 3]);
    const an = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i + 1, price: 10 + i }));
    const ok = [{ id: 'f', tool: 'forecast', anchors: an(2) }, { id: 'p', tool: 'projection', anchors: an(3) }];
    const bad = [
      { id: 'f2', tool: 'forecast', anchors: an(3) },
      { id: 'p2', tool: 'projection', anchors: an(2) },
      { id: 'f3', tool: 'forecast', anchors: [{ time: 1, price: 1 }, { time: 2, price: Number.NaN }] },
    ];
    expect(parseStore({ version: 2, sources: { s: [...ok, ...bad] } }, ANCHOR_COUNTS, undefined, undefined, undefined, undefined, VALIDATORS).sources).toEqual({ s: ok });
  });
});

describe('the cycle tools', () => {
  it('round trips each with two anchors and drops a wrong count', async () => {
    const { ANCHOR_COUNTS } = await import('../components/chart/tools');
    const an = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i + 1, price: i + 1 }));
    const ids = ['cyclicLines', 'timeCycles', 'sineLine'];
    expect(ids.map((t) => ANCHOR_COUNTS[t])).toEqual([2, 2, 2]);
    const ok = ids.map((tool) => ({ id: tool, tool, anchors: an(2) }));
    const bad = ids.map((tool) => ({ id: `${tool}-bad`, tool, anchors: an(3) }));
    expect(parseStore({ version: 2, sources: { s: [...ok, ...bad] } }, ANCHOR_COUNTS).sources).toEqual({ s: ok });
  });
});

describe('the volume-based tools', () => {
  it('round trips each with a style and drops a wrong count', async () => {
    const { ANCHOR_COUNTS } = await import('../components/chart/tools');
    const an = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i + 1, price: i + 1 }));
    const ids = ['anchoredVwap', 'fixedRangeVolumeProfile', 'anchoredVolumeProfile'];
    expect(ids.map((t) => ANCHOR_COUNTS[t])).toEqual([1, 2, 1]);
    const style = { source: 'hl2', showBand2: true, rowSize: 12, valueAreaVolume: 80, placement: 'right', upColor: '#112233' };
    const ok = ids.map((tool) => ({ id: tool, tool, anchors: an(ANCHOR_COUNTS[tool] as number), style }));
    const bad = ids.map((tool) => ({ id: `${tool}-bad`, tool, anchors: an((ANCHOR_COUNTS[tool] as number) + 1) }));
    const loaded = parseStore({ version: 2, sources: { s: [...ok, ...bad] } }, ANCHOR_COUNTS).sources.s;
    expect(loaded.map((d) => d.id)).toEqual(ids);
  });
});

describe('the pitchfork tools', () => {
  it('round trips each with three anchors and a custom levels list and drops a wrong count', async () => {
    const { ANCHOR_COUNTS } = await import('../components/chart/tools');
    const an = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i + 1, price: i + 1 }));
    const ids = ['pitchfork', 'schiffPitchfork', 'modifiedSchiffPitchfork', 'insidePitchfork'];
    expect(ids.map((t) => ANCHOR_COUNTS[t])).toEqual([3, 3, 3, 3]);
    const style = { levels: [{ value: 0.5, color: '#112233', on: true }, { value: 3, color: 'accent', on: false }] };
    const ok = ids.map((tool) => ({ id: tool, tool, anchors: an(3), style }));
    const bad = ids.map((tool) => ({ id: `${tool}-bad`, tool, anchors: an(2) }));
    expect(parseStore({ version: 2, sources: { s: [...ok, ...bad] } }, ANCHOR_COUNTS).sources).toEqual({ s: ok });
  });
});

describe('the three-point Fibonacci tools', () => {
  it('round trips each with three anchors and a custom levels list and drops a wrong count', async () => {
    const { ANCHOR_COUNTS } = await import('../components/chart/tools');
    const an = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i + 1, price: i + 1 }));
    const ids = ['fibExtension', 'fibChannel', 'fibTrendTime', 'fibWedge', 'pitchfan'];
    expect(ids.map((t) => ANCHOR_COUNTS[t])).toEqual([3, 3, 3, 3, 3]);
    const style = { levels: [{ value: 0.5, color: '#112233', on: true }, { value: 3, color: 'accent', on: false }] };
    const ok = ids.map((tool) => ({ id: tool, tool, anchors: an(3), style }));
    const bad = ids.map((tool) => ({ id: `${tool}-bad`, tool, anchors: an(2) }));
    expect(parseStore({ version: 2, sources: { s: [...ok, ...bad] } }, ANCHOR_COUNTS).sources).toEqual({ s: ok });
  });
});

describe('drawing management edits', () => {
  const t = (id: string): Drawing => ({ id, tool: 'trendLine', anchors: [{ time: 1, price: 1 }, { time: 2, price: 2 }] });
  const three = () => emptyState([t('a'), t('b'), t('c')]);
  const ids = (s: { drawings: Drawing[] }) => s.drawings.map((d) => d.id);

  it('locks and unlocks over several ids as one undo step, and is a no-op when unchanged', () => {
    const s = three();
    const locked = setLocked(s, ['a', 'c', 'zz'], true);
    expect(locked.drawings.map((d) => d.locked)).toEqual([true, undefined, true]);
    expect(locked.past).toHaveLength(1);
    expect(setLocked(locked, ['a', 'c'], true)).toBe(locked);
    const open = setLocked(locked, ['a'], false);
    expect('locked' in open.drawings[0]).toBe(false);
    expect(undo(locked).drawings).toBe(s.drawings);
    expect(setLocked(s, ['a'], false)).toBe(s);
  });

  it('hides and shows over several ids as one undo step, and is a no-op when unchanged', () => {
    const s = three();
    const hid = setHidden(s, ['a', 'c', 'zz'], true);
    expect(hid.drawings.map((d) => d.hidden)).toEqual([true, undefined, true]);
    expect(hid.past).toHaveLength(1);
    expect(setHidden(hid, ['a', 'c'], true)).toBe(hid);
    const shown = setHidden(hid, ['a'], false);
    expect('hidden' in shown.drawings[0]).toBe(false);
    expect(undo(hid).drawings).toBe(s.drawings);
    expect(setHidden(s, ['a'], false)).toBe(s);
  });

  it('moveTo puts a drawing at a paint-order index as one undo step', () => {
    const s = emptyState([t('a'), t('b'), t('c'), t('d')]);
    expect(ids(moveTo(s, 'a', 3))).toEqual(['b', 'c', 'd', 'a']);
    expect(ids(moveTo(s, 'd', 0))).toEqual(['d', 'a', 'b', 'c']);
    expect(ids(moveTo(s, 'a', 2))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(moveTo(s, 'c', 1))).toEqual(['a', 'c', 'b', 'd']);
    expect(moveTo(s, 'a', 3).past).toHaveLength(1);
    expect(undo(moveTo(s, 'a', 3)).drawings).toBe(s.drawings);
    expect(moveTo(s, 'b', 1)).toBe(s);
    expect(moveTo(s, 'zz', 1)).toBe(s);
  });

  it('parseStore keeps hidden: true and drops any other hidden value', () => {
    const got = parseStore(
      { version: 2, sources: { s: [{ ...t('a'), hidden: true }, { ...t('b'), hidden: 'yes' }, { ...t('c'), hidden: false }] } },
      COUNTS,
      TEXT,
      TRANSIENT,
    ).sources.s;
    expect(got[0].hidden).toBe(true);
    expect('hidden' in got[1]).toBe(false);
    expect('hidden' in got[2]).toBe(false);
  });

  it('renames, trims, cuts to 60 and clears; the same state when unchanged', () => {
    const s = three();
    const named = rename(s, 'b', '  Support  ');
    expect(named.drawings[1].name).toBe('Support');
    expect(rename(named, 'b', 'Support')).toBe(named);
    expect(rename(s, 'b', '   ')).toBe(s);
    expect(rename(s, 'nope', 'x')).toBe(s);
    expect(rename(s, 'a', 'x'.repeat(100)).drawings[0].name).toHaveLength(60);
    const cleared = rename(named, 'b', '');
    expect('name' in cleared.drawings[1]).toBe(false);
    expect(undo(cleared).drawings).toBe(named.drawings);
  });

  it('reorders only the order', () => {
    const s = three();
    expect(ids(reorder(s, 'a', 'front'))).toEqual(['b', 'c', 'a']);
    expect(ids(reorder(s, 'c', 'back'))).toEqual(['c', 'a', 'b']);
    expect(ids(reorder(s, 'a', 'forward'))).toEqual(['b', 'a', 'c']);
    expect(ids(reorder(s, 'c', 'backward'))).toEqual(['a', 'c', 'b']);
    expect(reorder(s, 'c', 'front')).toBe(s);
    expect(reorder(s, 'a', 'back')).toBe(s);
    expect(reorder(s, 'c', 'forward')).toBe(s);
    expect(reorder(s, 'a', 'backward')).toBe(s);
    expect(reorder(s, 'zz', 'front')).toBe(s);
    const moved = reorder(s, 'a', 'front');
    expect(moved.past).toHaveLength(1);
    expect([...moved.drawings].sort((x, y) => x.id.localeCompare(y.id))).toEqual(s.drawings);
  });

  it('reorderMany keeps the relative order at the front and back and steps past the nearest unselected neighbour', () => {
    const five = { ...emptyState(['a', 'b', 'c', 'd', 'e'].map((x) => t(x))) };
    expect(ids(reorderMany(five, ['b', 'd'], 'front'))).toEqual(['a', 'c', 'e', 'b', 'd']);
    expect(ids(reorderMany(five, ['d', 'b'], 'back'))).toEqual(['b', 'd', 'a', 'c', 'e']);
    expect(ids(reorderMany(five, ['b', 'c'], 'forward'))).toEqual(['a', 'd', 'b', 'c', 'e']);
    expect(ids(reorderMany(five, ['b', 'e'], 'forward'))).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(ids(reorderMany(five, ['c', 'd'], 'backward'))).toEqual(['a', 'c', 'd', 'b', 'e']);
    expect(ids(reorderMany(five, ['a', 'c'], 'backward'))).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(reorderMany(five, ['d', 'e'], 'front')).toBe(five);
    expect(reorderMany(five, ['a', 'b'], 'back')).toBe(five);
    expect(reorderMany(five, ['d', 'e'], 'forward')).toBe(five);
    expect(reorderMany(five, ['a', 'b'], 'backward')).toBe(five);
    expect(reorderMany(five, ['zz'], 'front')).toBe(five);
    expect(reorderMany(five, ['b', 'd'], 'front').past).toHaveLength(1);
  });

  it('previewMany then commit is one undo step that one undo restores', () => {
    const s = three();
    const before = s.drawings;
    const moved = (id: string) => [{ time: 500, price: 1 }, { time: 600, price: 2 }].map((a) => ({ ...a, price: a.price + id.length }));
    const p = previewMany(s, { a: moved('a'), c: moved('c') });
    expect(p.drawings[0].anchors).toEqual(moved('a'));
    expect(p.drawings[1]).toBe(before[1]);
    expect(p.past).toHaveLength(0);
    const done = commit(p, before);
    expect(done.past).toHaveLength(1);
    expect(undo(done).drawings).toEqual(before);
  });

  it('removeMany, setLocked and cloneMany of a selection are one step each', () => {
    const s = three();
    expect(removeMany(s, ['a', 'c']).past).toHaveLength(1);
    expect(setLocked(s, ['a', 'b'], true).past).toHaveLength(1);
    expect(cloneMany(s, ['a', 'b']).past).toHaveLength(1);
  });

  it('clones just above the originals with new unique ids and independent anchors', () => {
    const s = three();
    const c = cloneMany(s, ['a', 'c']);
    expect(c.drawings).toHaveLength(5);
    expect(c.drawings[0]).toBe(s.drawings[0]);
    expect(c.drawings[2]).toBe(s.drawings[1]);
    expect(c.drawings[1].anchors).toEqual(s.drawings[0].anchors);
    expect(c.drawings[1].anchors).not.toBe(s.drawings[0].anchors);
    expect(new Set(ids(c)).size).toBe(5);
    expect(c.past).toHaveLength(1);
    expect(cloneMany(s, ['zz'])).toBe(s);
  });

  it('pastes copies on top with new ids, even twice of the same clipboard', () => {
    const s = three();
    const clip = [{ ...t('a'), name: 'n', locked: true as const }];
    const p = paste(paste(s, clip), clip);
    expect(p.drawings).toHaveLength(5);
    expect(new Set(ids(p)).size).toBe(5);
    expect(p.drawings[4]).toMatchObject({ name: 'n', locked: true, anchors: clip[0].anchors });
    expect(paste(s, [])).toBe(s);
    expect(undo(paste(s, clip)).drawings).toBe(s.drawings);
  });

  it('removes several drawings as one step', () => {
    const s = three();
    const r = removeMany(s, ['a', 'c']);
    expect(ids(r)).toEqual(['b']);
    expect(r.past).toHaveLength(1);
    expect(removeMany(s, ['zz'])).toBe(s);
  });

  it('keeps locked true and a clean name when loading, drops bad ones, and loads older payloads unchanged', () => {
    const base = t('a');
    const load = (extra: object) => parseStore({ version: STORAGE_VERSION, sources: { s: [{ ...base, ...extra }] } }, COUNTS).sources.s[0];
    expect(STORAGE_VERSION).toBe(2);
    expect(load({ locked: true, name: '  Hi  ' })).toMatchObject({ locked: true, name: 'Hi' });
    expect('locked' in load({ locked: 'yes' })).toBe(false);
    expect('name' in load({ name: '   ' })).toBe(false);
    expect('name' in load({ name: 7 })).toBe(false);
    expect(load({ name: 'y'.repeat(90) }).name).toHaveLength(60);
    expect(load({})).toEqual(base);
  });
});

describe('caption tools', () => {
  const CAPTION = new Set(['arrowMarkUp', 'arrowMarker']);
  const counts = { ...COUNTS, arrowMarkUp: 1, arrowMarker: 2, circle: 2, arrow: 2, arrowMarkDown: 1, text: 1, rotatedRectangle: 3, ellipse: 3, triangle: 3, arc: 3, curve: 3, doubleCurve: 4 };
  const an = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i + 1, price: i + 1 }));
  const parse = (list: unknown[]) => parseStore({ version: 2, sources: { s: list } }, counts, TEXT, TRANSIENT, new Set(), CAPTION).sources.s;
  it('round trips each new tool id', () => {
    const list = [['circle', 2], ['arrow', 2], ['arrowMarker', 2], ['arrowMarkUp', 1], ['arrowMarkDown', 1]].map(([tool, n]) => ({ id: String(tool), tool, anchors: an(n as number) }));
    expect(parse(list)).toEqual(list);
  });
  it('round trips the three and four anchor shapes and drops a wrong count alone', () => {
    const list = [['rotatedRectangle', 3], ['ellipse', 3], ['triangle', 3], ['arc', 3], ['curve', 3], ['doubleCurve', 4]].map(([tool, n]) => ({ id: String(tool), tool, anchors: an(n as number) }));
    expect(parse(list)).toEqual(list);
    expect(parse([{ id: 'x', tool: 'curve', anchors: an(2) }, { id: 'y', tool: 'doubleCurve', anchors: an(3) }, list[0]])).toEqual([list[0]]);
  });
  it('keeps a cleaned label and the drawing when it is empty, missing or not a string', () => {
    const d = (id: string, text: unknown) => ({ id, tool: 'arrowMarkUp', anchors: an(1), ...(text === undefined ? {} : { text }) });
    expect(parse([d('a', '  hi  '), d('b', '   '), d('c', undefined), d('e', 5), d('f', 'x'.repeat(600))])).toEqual([
      { ...d('a', 'hi') },
      d('b', undefined),
      d('c', undefined),
      d('e', undefined),
      d('f', 'x'.repeat(500)),
    ]);
  });
  it('drops a wrong anchor count alone', () => {
    const ok = { id: 'k', tool: 'arrowMarker', anchors: an(2), text: 'a' };
    expect(parse([{ id: 'x', tool: 'arrowMarker', anchors: an(1), text: 'a' }, ok])).toEqual([ok]);
  });
  it('a text tool still drops a drawing without text and a non-caption tool drops text', () => {
    expect(parse([{ id: 't', tool: 'text', anchors: an(1) }, { id: 'c', tool: 'circle', anchors: an(2), text: 'x' }])).toEqual([{ id: 'c', tool: 'circle', anchors: an(2) }]);
  });
  it('keeps an unknown tool exactly as stored', () => {
    const unknown = { id: 'u', tool: 'future', anchors: [], text: ' raw ' };
    expect(parse([unknown])).toEqual([unknown]);
  });
  it('a label cleared in the settings dialog is removed from the drawing', () => {
    const s = emptyState([{ id: 'a', tool: 'arrowMarkUp', anchors: an(1), text: 'hi' }]);
    expect(previewPatch(s, 'a', { text: '' }).drawings[0]).toEqual({ id: 'a', tool: 'arrowMarkUp', anchors: an(1) });
    expect(previewPatch(s, 'a', { text: 'yo' }).drawings[0].text).toBe('yo');
  });
});

describe('tools with a range of anchors', () => {
  const counts = { ...COUNTS, path: { min: 2, max: 5 }, polyline: { min: 3, max: 5 } };
  const an = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i + 1, price: i + 1 }));
  const parse = (list: unknown[]) => parseStore({ version: 2, sources: { s: list } }, counts, TEXT, TRANSIENT).sources.s;
  it('keeps a path and a polyline within their range and drops the others alone', () => {
    const ok = [2, 3, 5].map((n) => ({ id: `p${n}`, tool: 'path', anchors: an(n) })).concat([3, 4, 5].map((n) => ({ id: `g${n}`, tool: 'polyline', anchors: an(n) })));
    const bad = [{ id: 'p1', tool: 'path', anchors: an(1) }, { id: 'p6', tool: 'path', anchors: an(6) }, { id: 'g2', tool: 'polyline', anchors: an(2) }, { id: 'g6', tool: 'polyline', anchors: an(6) }];
    expect(parse([...bad, ...ok])).toEqual(ok);
  });
  it('keeps a brush and a highlighter at 2 to 200 anchors and drops 1 and 201 alone', () => {
    const big = { ...counts, brush: { min: 2, max: 200 }, highlighter: { min: 2, max: 200 } };
    const run = (list: unknown[]) => parseStore({ version: 2, sources: { s: list } }, big, TEXT, TRANSIENT).sources.s;
    const ok = ['brush', 'highlighter'].flatMap((tool) => [2, 200].map((n) => ({ id: `${tool}${n}`, tool, anchors: an(n) })));
    const bad = ['brush', 'highlighter'].flatMap((tool) => [1, 201].map((n) => ({ id: `${tool}b${n}`, tool, anchors: an(n) })));
    expect(run([...bad, ...ok])).toEqual(ok);
  });
  it('drops a drawing with a bad point alone', () => {
    const ok = { id: 'ok', tool: 'path', anchors: an(3) };
    expect(parse([{ id: 'x', tool: 'path', anchors: [...an(2), { time: NaN, price: 1 }] }, ok])).toEqual([ok]);
  });
  it('still drops a fixed-count tool with a wrong count and keeps an unknown tool as stored', () => {
    const unknown = { id: 'u', tool: 'future', anchors: an(7) };
    const ok = { id: 't', tool: 'trendLine', anchors: an(2) };
    expect(parse([{ id: 'bad', tool: 'trendLine', anchors: an(3) }, ok, unknown])).toEqual([ok, unknown]);
  });
});

describe('table cells', () => {
  const tbl = (id: string, cells?: unknown) => ({ id, tool: 'table', anchors: [{ time: 1, price: 1 }], ...(cells === undefined ? {} : { cells }) });
  const COUNTS_T = { ...COUNTS, table: 1 };
  const withTable = () => add(emptyState(), tbl('t', [['a', 'b'], ['c', 'd']]) as Drawing);

  it('round-trips through parseStore with the validators, padding ragged rows', () => {
    const raw = { version: 2, sources: { s: [tbl('t', [['a'], ['b', 'c']])] } };
    expect(parseStore(JSON.parse(JSON.stringify(raw)), COUNTS_T, undefined, undefined, undefined, undefined, VALIDATORS).sources.s).toEqual([tbl('t', [['a', ''], ['b', 'c']])]);
  });
  it('drops a table with bad cells alone, its neighbours load', () => {
    const raw = { version: 2, sources: { s: [trend('a'), tbl('x', 'nope'), tbl('y', []), tbl('z', [[1]]), tbl('ok', [['q']]), hline('b')] } };
    const ids = parseStore(raw, COUNTS_T, undefined, undefined, undefined, undefined, VALIDATORS).sources.s.map((d) => d.id);
    expect(ids).toEqual(['a', 'ok', 'b']);
  });
  it('parseStore without validators keeps stored cells as they were', () => {
    const raw = { version: 2, sources: { s: [tbl('x', 'nope')] } };
    expect(parseStore(raw, COUNTS_T).sources.s).toEqual([tbl('x', 'nope')]);
  });
  it('a table without cells is kept', () => {
    const raw = { version: 2, sources: { s: [tbl('x')] } };
    expect(parseStore(raw, COUNTS_T, undefined, undefined, undefined, undefined, VALIDATORS).sources.s).toEqual([tbl('x')]);
  });
  it('setCell is one undo step with redo, cleans the text and is a no-op when nothing changes', () => {
    const s0 = withTable();
    const s1 = setCell(s0, 't', 1, 0, '  hello  ');
    expect(s1.drawings[0].cells).toEqual([['a', 'b'], ['hello', 'd']]);
    expect(s1.past).toHaveLength(s0.past.length + 1);
    expect(setCell(s1, 't', 1, 0, 'hello')).toBe(s1);
    expect(setCell(s1, 't', 9, 9, 'x')).toBe(s1);
    expect(setCell(s1, 'nope', 0, 0, 'x')).toBe(s1);
    const u = undo(s1);
    expect(u.drawings[0].cells).toEqual([['a', 'b'], ['c', 'd']]);
    expect(redo(u).drawings[0].cells).toEqual([['a', 'b'], ['hello', 'd']]);
  });
  it('setCells is one undo step and a no-op when equal', () => {
    const s0 = withTable();
    const s1 = setCells(s0, 't', [['x']]);
    expect(s1.drawings[0].cells).toEqual([['x']]);
    expect(s1.past).toHaveLength(s0.past.length + 1);
    expect(setCells(s1, 't', [['x']])).toBe(s1);
    expect(undo(s1).drawings[0].cells).toEqual([['a', 'b'], ['c', 'd']]);
  });
  it('previewPatch with cells leaves history untouched', () => {
    const s0 = withTable();
    const s1 = previewPatch(s0, 't', { cells: [['z', 'z', 'z']] });
    expect(s1.drawings[0].cells).toEqual([['z', 'z', 'z']]);
    expect(s1.past).toBe(s0.past);
    expect(s1.future).toBe(s0.future);
  });
  it('cloneMany copies the cells', () => {
    const s1 = cloneMany(withTable(), ['t']);
    expect(s1.drawings).toHaveLength(2);
    expect(s1.drawings[1].cells).toEqual([['a', 'b'], ['c', 'd']]);
    expect(s1.drawings[1].cells).not.toBe(s1.drawings[0].cells);
  });
});

describe('glyph drawings (icon, emoji, sticker)', () => {
  const glyph = (tool: string, id: string, extra: Record<string, unknown> = {}) => ({ id, tool, anchors: [{ time: 5, price: 7 }], glyph: 'flag', style: { size: 64, angle: 30 }, ...extra });
  const COUNTS_G = { ...COUNTS, icon: 1, emoji: 1, sticker: 1 };
  const parse = (list: unknown[]) => parseStore({ version: 2, sources: { s: list } }, COUNTS_G, undefined, undefined, undefined, undefined, VALIDATORS).sources.s ?? [];

  it('each tool round-trips through save and load with its glyph, size and angle', () => {
    for (const tool of ['icon', 'emoji', 'sticker']) {
      const d = glyph(tool, tool, { glyph: `${tool}-id` });
      saveDrawings({ s: [d as Drawing] });
      const back = loadDrawings(COUNTS_G, undefined, undefined, undefined, undefined, VALIDATORS).sources.s;
      expect(back).toEqual([d]);
      expect(back[0].glyph).toBe(`${tool}-id`);
      expect(back[0].style).toEqual({ size: 64, angle: 30 });
      store.clear();
    }
  });
  it('keeps a glyph id the sets do not know, and drops a drawing with no usable glyph alone', () => {
    const unknown = glyph('icon', 'u', { glyph: 'not-in-any-set' });
    const missing = { id: 'm', tool: 'emoji', anchors: [{ time: 1, price: 1 }] };
    const empty = glyph('sticker', 'e', { glyph: '' });
    const num = glyph('icon', 'n', { glyph: 5 });
    expect(parse([trend('a'), missing, unknown, empty, num, hline('b')]).map((d) => d.id)).toEqual(['a', 'u', 'b']);
  });
  it('cloneMany and paste keep the glyph and style, and undo and redo restore the drawing', () => {
    const s0 = add(emptyState(), glyph('emoji', 'g') as Drawing);
    const s1 = cloneMany(s0, ['g']);
    expect(s1.drawings[1]).toMatchObject({ tool: 'emoji', glyph: 'flag', style: { size: 64, angle: 30 } });
    expect(s1.drawings[1].id).not.toBe('g');
    expect(paste(emptyState(), [s0.drawings[0]]).drawings[0].glyph).toBe('flag');
    expect(undo(s1).drawings).toHaveLength(1);
    expect(redo(undo(s1)).drawings[1].glyph).toBe('flag');
  });
  it('a style preview with the anchors unchanged leaves history alone and the commit is one undo step', () => {
    const s0 = add(emptyState(), glyph('sticker', 'g') as Drawing);
    const live = previewPatch(s0, 'g', { anchors: s0.drawings[0].anchors, style: { size: 200, angle: 90 } });
    expect(live.past).toBe(s0.past);
    expect(live.drawings[0].style).toEqual({ size: 200, angle: 90 });
    expect(live.drawings[0].glyph).toBe('flag');
    const done = commit(live, s0.drawings);
    expect(done.past).toHaveLength(s0.past.length + 1);
    expect(undo(done).drawings[0].style).toEqual({ size: 64, angle: 30 });
  });
});

describe('image drawings', () => {
  const KEY = 'b'.repeat(64);
  const pic = (id: string): Drawing => ({ id, tool: 'image', anchors: [{ time: 100, price: 9 }, { time: 200, price: 4 }], image: { key: KEY, w: 40, h: 30 } });
  const IMAGE_COUNTS = { ...COUNTS, image: 2 };

  it('round-trips its image field through parseStore, and the tool check drops a malformed one', () => {
    const raw = { version: 2, sources: { a: [pic('p'), { ...pic('q'), image: { key: 'nope', w: 1, h: 1 } }, { ...pic('r'), tool: 'future', image: { key: 'x' } }] } };
    const got = parseStore(raw, IMAGE_COUNTS, TEXT, TRANSIENT, undefined, undefined, VALIDATORS);
    expect(got.sources.a.map((d) => d.id)).toEqual(['p', 'r']);
    expect(got.sources.a[0].image).toEqual({ key: KEY, w: 40, h: 30 });
  });

  it('copies the same image key on clone and paste', () => {
    const s = cloneMany(emptyState([pic('p')]), ['p']);
    expect(s.drawings).toHaveLength(2);
    expect(s.drawings[1].image).toEqual({ key: KEY, w: 40, h: 30 });
    expect(s.drawings[1].id).not.toBe('p');
    const pasted = paste(emptyState(), [pic('p')]);
    expect(pasted.drawings[0].image?.key).toBe(KEY);
  });

  it('keeps the picture when a delete is undone and redone', () => {
    const del = removeMany(emptyState([pic('p')]), ['p']);
    expect(del.drawings).toEqual([]);
    expect(stateImageKeys(del)).toEqual([KEY]); // still held by the undo snapshot
    const back = undo(del);
    expect(back.drawings[0].image?.key).toBe(KEY);
    expect(redo(back).drawings).toEqual([]);
  });

  it('lists the keys of drawings, history snapshots and every stored source', () => {
    expect(imageKeys([pic('p'), trend('t'), null, 'x'])).toEqual([KEY]);
    saveDrawings({ a: [pic('p')], b: [{ ...pic('q'), tool: 'future' }, trend('t')] });
    expect(persistedImageKeys()).toEqual({ keys: new Set([KEY]), newer: false });
    store.set('vost.drawings.v2', JSON.stringify({ version: 3, sources: {} }));
    expect(persistedImageKeys()).toEqual({ keys: new Set(), newer: true });
    store.set('vost.drawings.v2', '{broken');
    expect(persistedImageKeys()).toBeNull();
    store.clear();
    expect(persistedImageKeys()).toEqual({ keys: new Set(), newer: false });
  });
});
