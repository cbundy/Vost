import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HISTORY_LIMIT,
  createDrawingsStorage,
  STORAGE_KEY,
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
} from './drawings';

const COUNTS = { trendLine: 2, horizontalLine: 1, ray: 2, rectangle: 2, fibRetracement: 2, text: 1 };
const TEXT = new Set(['text']);
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
    expect(JSON.parse(store.get('vost.' + STORAGE_KEY)!).version).toBe(1);
  });
  it('loads none when missing, unparsable or the wrong shape', () => {
    expect(loadDrawings(COUNTS).sources).toEqual({});
    store.set('vost.' + STORAGE_KEY, '{nope');
    expect(loadDrawings(COUNTS).sources).toEqual({});
    for (const bad of [null, 5, [], { version: 1 }, { version: 1, sources: [] }, { version: 'x', sources: {} }, { sources: {} }]) {
      expect(parseStore(bad, COUNTS)).toEqual({ sources: {}, newer: false });
    }
  });
  it('drops a bad item alone', () => {
    const raw = {
      version: 1,
      sources: {
        s: [
          trend('a'),
          { id: 'u', tool: 'fib', anchors: [{ time: 1, price: 1 }] },
          { id: 'n', tool: 'trendLine', anchors: [{ time: 1, price: NaN }, { time: 2, price: 2 }] },
          { id: 'c', tool: 'trendLine', anchors: [{ time: 1, price: 1 }] },
          { id: 'p', tool: 'toString', anchors: [] },
          'junk',
          hline('b'),
        ],
        t: 'not a list',
      },
    };
    expect(parseStore(JSON.parse(JSON.stringify(raw)), COUNTS).sources).toEqual({ s: [trend('a'), hline('b')] });
  });
  it('keeps ray, rectangle and fibRetracement with 2 anchors and drops other counts', () => {
    const an = (n: number) => Array.from({ length: n }, (_, i) => ({ time: i + 1, price: i + 1 }));
    const ok = ['ray', 'rectangle', 'fibRetracement'].map((tool) => ({ id: tool, tool, anchors: an(2) }));
    const bad = ['ray', 'rectangle', 'fibRetracement'].flatMap((tool) => [1, 3].map((n) => ({ id: `${tool}${n}`, tool, anchors: an(n) })));
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
    expect(parseStore({ version: 1, sources: { s: [measure, trend('a')] } }, COUNTS, TEXT).sources).toEqual({ s: [trend('a')] });
  });
  it('treats a newer version as none and leaves it in storage until the user saves', () => {
    const newer = JSON.stringify({ version: 2, sources: { s: [trend('a')] } });
    store.set('vost.' + STORAGE_KEY, newer);
    const got = loadDrawings(COUNTS);
    expect(got).toEqual({ sources: {}, newer: true });
    expect(store.get('vost.' + STORAGE_KEY)).toBe(newer);
    saveDrawings({ s: [hline('z')] });
    expect(JSON.parse(store.get('vost.' + STORAGE_KEY)!).version).toBe(1);
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
