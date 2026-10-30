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
  rename,
  reorder,
  reorderMany,
  previewMany,
  cloneMany,
  paste,
  removeMany,
} from './drawings';

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
    const ok = ids.map((tool) => ({ id: tool, tool, anchors: an(ANCHOR_COUNTS[tool]) }));
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
    const ok = ids.map((tool) => ({ id: tool, tool, anchors: an(ANCHOR_COUNTS[tool]) }));
    const bad = ids.map((tool) => ({ id: `${tool}-bad`, tool, anchors: an(ANCHOR_COUNTS[tool] === 3 ? 2 : 3) }));
    expect(parseStore({ version: 2, sources: { s: [...ok, ...bad] } }, ANCHOR_COUNTS).sources).toEqual({ s: ok });
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
  const counts = { ...COUNTS, arrowMarkUp: 1, arrowMarker: 2, circle: 2, arrow: 2, arrowMarkDown: 1, text: 1 };
  const an = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i + 1, price: i + 1 }));
  const parse = (list: unknown[]) => parseStore({ version: 2, sources: { s: list } }, counts, TEXT, TRANSIENT, new Set(), CAPTION).sources.s;
  it('round trips each new tool id', () => {
    const list = [['circle', 2], ['arrow', 2], ['arrowMarker', 2], ['arrowMarkUp', 1], ['arrowMarkDown', 1]].map(([tool, n]) => ({ id: String(tool), tool, anchors: an(n as number) }));
    expect(parse(list)).toEqual(list);
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
