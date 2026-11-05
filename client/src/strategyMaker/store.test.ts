import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB_NAME, openStore, setId, type HighlightSet, type Store } from './store';

const trade = { side: 'long' as const, entryTime: 100, exitTime: 400 };
const provSource = { kind: 'provider' as const, provider: 'demo', symbol: 'BTC', timeframe: '1h' };
const mk = (source: HighlightSet['source'], extra: Partial<HighlightSet> = {}): HighlightSet => ({
  id: setId(source),
  version: 1,
  source,
  trades: [trade],
  updatedAt: 1,
  ...extra,
});

const opened: Store[] = [];

afterEach(async () => {
  for (const s of opened.splice(0)) s.close();
  vi.unstubAllGlobals();
  await new Promise<void>((r) => {
    const q = indexedDB.deleteDatabase(DB_NAME);
    q.onsuccess = q.onerror = q.onblocked = () => r();
  });
});

async function open(): Promise<Store> {
  const s = await openStore();
  if (!s) throw new Error('store should open');
  opened.push(s);
  return s;
}

describe('setId', () => {
  it('derives a stable id per source and tells sources apart', () => {
    expect(setId(provSource)).toBe(setId({ ...provSource }));
    expect(setId(provSource)).not.toBe(setId({ ...provSource, timeframe: '4h' }));
    expect(setId({ kind: 'library', datasetId: 'x' })).not.toBe(setId({ kind: 'csv', name: 'x' }));
  });
});

describe('store', () => {
  it('saves and loads by source, and updates in place', async () => {
    const s = await open();
    await s.put(mk(provSource));
    expect((await s.get(setId(provSource)))?.trades).toEqual([trade]);
    await s.put(mk(provSource, { trades: [], updatedAt: 2 }));
    const got = await s.get(setId(provSource));
    expect(got?.trades).toEqual([]);
    expect(got?.updatedAt).toBe(2);
    expect(await s.list()).toHaveLength(1);
  });
  it('lists every set and deletes one', async () => {
    const s = await open();
    await s.put(mk(provSource));
    await s.put(mk({ kind: 'library', datasetId: 'd1' }));
    expect(await s.list()).toHaveLength(2);
    await s.delete(setId(provSource));
    expect((await s.list()).map((x) => x.source.kind)).toEqual(['library']);
    expect(await s.get(setId(provSource))).toBeUndefined();
  });
  it('keeps the candles of a csv set', async () => {
    const s = await open();
    const candles = [{ time: 1, open: 1, high: 2, low: 0, close: 1, volume: 3 }];
    await s.put(mk({ kind: 'csv', name: 'a.csv' }, { candles }));
    expect((await s.get(setId({ kind: 'csv', name: 'a.csv' })))?.candles).toEqual(candles);
  });
  it('survives opening again (a reload)', async () => {
    await (await open()).put(mk(provSource));
    expect((await (await open()).get(setId(provSource)))?.trades).toEqual([trade]);
  });
  it('gives null, not a throw, when indexedDB.open throws', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('blocked');
      },
    });
    expect(await openStore()).toBeNull();
  });
  it('gives null when the open request errors', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: Record<string, unknown> = { error: new Error('denied') };
        queueMicrotask(() => (req.onerror as () => void)());
        return req;
      },
    });
    expect(await openStore()).toBeNull();
  });
  it('gives null when indexedDB is missing', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await openStore()).toBeNull();
  });
});
