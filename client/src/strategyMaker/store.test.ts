import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { DB_NAME } from './migrate';
import {
  KEEPALIVE_LIMIT,
  MODEL_ID,
  openStore,
  setId,
  StoreError,
  whyNotSaved,
  type FindForm,
  type HighlightSet,
  type ModelRecord,
  type Store,
  type StoreResponse,
  type StoreTransport,
} from './store';
import type { TrainResult } from './engine';

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

const res = (status: number, body?: unknown): StoreResponse => ({ status, json: async () => body });

interface Call {
  method: string;
  url: string;
  init: RequestInit;
}

/** A server that keeps what it is sent, as the real one does, and records every request. */
function fakeServer(): { transport: StoreTransport; calls: Call[]; sets: Map<string, unknown>; docs: Map<string, unknown>; fail: { status: number; error?: string } | null; setFail(f: { status: number; error?: string } | null): void } {
  const sets = new Map<string, unknown>();
  const docs = new Map<string, unknown>();
  const calls: Call[] = [];
  const state = {
    fail: null as { status: number; error?: string } | null,
  };
  const transport: StoreTransport = async (url, init) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, init });
    const rest = url.replace('/api/strategy-maker/', '');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    if (method !== 'GET' && state.fail) return res(state.fail.status, { error: state.fail.error ?? 'no' });
    if (method !== 'GET' && !(init.headers as Record<string, string> | undefined)?.['content-type']) return res(415, { error: 'json' });
    if (rest === 'sets') return res(200, { sets: [...sets.values()] });
    if (rest === 'import') {
      for (const s of body.sets) sets.set(s.id, s);
      if (body.model) docs.set('model', body.model);
      return res(204);
    }
    const setMatch = /^sets\/(.*)$/.exec(rest);
    const [map, key] = setMatch ? [sets, decodeURIComponent(setMatch[1]!)] : [docs, rest];
    if (method === 'GET') return map.has(key) ? res(200, map.get(key)) : res(404, { error: 'none' });
    if (method === 'PUT') return map.set(key, body), res(204);
    if (method === 'DELETE') return map.delete(key) ? res(204) : res(404, { error: 'none' });
    return res(405);
  };
  return { transport, calls, sets, docs, get fail() { return state.fail; }, setFail: (f) => void (state.fail = f) };
}

async function open(server = fakeServer()): Promise<{ store: Store; server: ReturnType<typeof fakeServer> }> {
  const store = await openStore({ transport: server.transport });
  if (!store) throw new Error('store should open');
  return { store, server };
}

describe('setId', () => {
  it('derives a stable id per source and tells sources apart', () => {
    expect(setId(provSource)).toBe(setId({ ...provSource }));
    expect(setId(provSource)).not.toBe(setId({ ...provSource, timeframe: '4h' }));
    expect(setId({ kind: 'library', datasetId: 'x' })).not.toBe(setId({ kind: 'csv', name: 'x' }));
  });
});

describe('server-backed store', () => {
  it('saves and loads by source, and updates in place', async () => {
    const { store: s } = await open();
    await s.put(mk(provSource));
    expect((await s.get(setId(provSource)))?.trades).toEqual([trade]);
    await s.put(mk(provSource, { trades: [], updatedAt: 2 }));
    const got = await s.get(setId(provSource));
    expect(got?.trades).toEqual([]);
    expect(got?.updatedAt).toBe(2);
    expect(await s.list()).toHaveLength(1);
  });

  it('lists every set and deletes one', async () => {
    const { store: s } = await open();
    await s.put(mk(provSource));
    await s.put(mk({ kind: 'library', datasetId: 'd1' }));
    expect(await s.list()).toHaveLength(2);
    await s.delete(setId(provSource));
    expect((await s.list()).map((x) => x.source.kind)).toEqual(['library']);
    expect(await s.get(setId(provSource))).toBeUndefined();
    await expect(s.delete(setId(provSource))).resolves.toBeUndefined();
  });

  it('encodes the id in the path and keeps the candles of a csv set', async () => {
    const { store: s, server } = await open();
    const candles = [{ time: 1, open: 1, high: 2, low: 0, close: 1, volume: 3 }];
    const src = { kind: 'csv' as const, name: 'a b/c|d.csv' };
    await s.put(mk(src, { candles }));
    expect(server.calls.at(-1)!.url).toBe(`/api/strategy-maker/sets/${encodeURIComponent('csv|a b/c|d.csv')}`);
    expect((await s.get(setId(src)))?.candles).toEqual(candles);
  });

  it('sees what another browser saved (a new store on the same server)', async () => {
    const server = fakeServer();
    await (await open(server)).store.put(mk(provSource));
    expect((await (await open(server)).store.get(setId(provSource)))?.trades).toEqual([trade]);
  });

  const form: FindForm = {
    direction: 'both',
    families: ['sma_cross'],
    feeBps: '10',
    slippageBps: '5',
    stopLossPct: '',
    takeProfitPct: '3',
    minRR: '1.5',
    minHitRatePct: '',
    maxDrawdownPct: '25',
    setIds: null,
  };
  it('round-trips the find inputs, and has none at first', async () => {
    const { store: s } = await open();
    expect(await s.getInputs()).toBeUndefined();
    await s.putInputs(form);
    await s.putInputs({ ...form, minRR: '2', setIds: ['csv|a.csv'] });
    expect(await s.getInputs()).toEqual({ id: 'find-inputs', version: 1, form: { ...form, minRR: '2', setIds: ['csv|a.csv'] } });
    expect(await s.list()).toEqual([]);
  });

  const record = (stamp = 'abc'): ModelRecord => ({
    id: MODEL_ID,
    version: 1,
    result: { kind: 'ok', rules: ['long when x'], usedTrades: 30 } as unknown as TrainResult,
    trainedOn: [{ id: setId(provSource), trades: 1, stamp }],
  });
  it('round-trips the model record, and has none at first', async () => {
    const { store: s } = await open();
    expect(await s.getModel()).toBeUndefined();
    await s.putModel(record());
    await s.putModel(record('def'));
    expect(await s.getModel()).toEqual(record('def'));
    expect(await s.getInputs()).toBeUndefined();
  });

  it('importAll sends the sets and the model in one request', async () => {
    const { store: s, server } = await open();
    await s.importAll([mk(provSource), mk({ kind: 'library', datasetId: 'd1' })], record());
    expect(server.calls.filter((c) => c.url.endsWith('/import'))).toHaveLength(1);
    expect((await s.list()).map((x) => x.id).sort()).toEqual([setId(provSource), 'library|d1'].sort());
    expect(await s.getModel()).toEqual(record());
    await s.importAll([], null);
    expect(await s.getModel()).toEqual(record());
  });

  it('a refused importAll rejects and leaves everything as it was', async () => {
    const { store: s, server } = await open();
    await s.put(mk(provSource, { updatedAt: 1 }));
    await s.putModel(record('old'));
    server.setFail({ status: 503, error: 'Check VOST_DATA_DIR' });
    await expect(s.importAll([mk(provSource, { updatedAt: 9 })], record('new'))).rejects.toThrow('Check VOST_DATA_DIR');
    server.setFail(null);
    expect((await s.list()).map((x) => [x.id, x.updatedAt])).toEqual([[setId(provSource), 1]]);
    expect((await s.getModel())?.trainedOn[0]!.stamp).toBe('old');
  });

  it('a rename keeps the id', async () => {
    const { store: s } = await open();
    await s.put(mk(provSource));
    const got = await s.get(setId(provSource));
    await s.put({ ...(got as HighlightSet), name: 'My BTC' });
    const after = await s.list();
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(setId(provSource));
    expect(after[0]!.name).toBe('My BTC');
  });

  it('a delete carries the JSON content type the server requires', async () => {
    const { store: s, server } = await open();
    await s.put(mk(provSource));
    await expect(s.delete(setId(provSource))).resolves.toBeUndefined();
    expect(server.sets.size).toBe(0);
  });

  it('close is a no-op', async () => {
    const { store: s } = await open();
    s.close();
    expect(await s.list()).toEqual([]);
  });
});

describe('keepalive writes', () => {
  it('uses keepalive for a small body and a normal request for a big one', async () => {
    const { store: s, server } = await open();
    await s.put(mk(provSource), { keepalive: true });
    expect(server.calls.at(-1)!.init.keepalive).toBe(true);
    await s.put(mk(provSource), {});
    expect(server.calls.at(-1)!.init.keepalive).toBeUndefined();
    const big = mk({ kind: 'csv', name: 'big.csv' }, { candles: Array.from({ length: 2000 }, (_, i) => ({ time: i, open: 1, high: 2, low: 0, close: 1, volume: 3 })) });
    expect(JSON.stringify(big).length).toBeGreaterThan(KEEPALIVE_LIMIT);
    await s.put(big, { keepalive: true });
    expect(server.calls.at(-1)!.init.keepalive).toBeUndefined();
    await s.delete(setId(provSource), { keepalive: true });
    expect(server.calls.at(-1)!.init.keepalive).toBe(true);
  });
});

describe('openStore without a reachable server', () => {
  it('gives null when the transport throws', async () => {
    const transport: StoreTransport = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await openStore({ transport })).toBeNull();
  });
  it('gives null on a 5xx from the probe, and a store on a 404', async () => {
    expect(await openStore({ transport: async () => res(502) })).toBeNull();
    expect(await openStore({ transport: async () => res(404) })).not.toBeNull();
  });
  it('does not touch the browser database when there is none', async () => {
    const before = await indexedDB.databases();
    await open();
    expect(await indexedDB.databases()).toEqual(before);
    expect((await indexedDB.databases()).some((d) => d.name === DB_NAME)).toBe(false);
  });
});

describe('whyNotSaved', () => {
  it('names the server reason for a 503 and otherwise that the server cannot be reached', () => {
    expect(whyNotSaved(new StoreError(503, 'Check VOST_DATA_DIR'))).toBe('Marks are not saved: Check VOST_DATA_DIR');
    expect(whyNotSaved(new StoreError(400, 'bad'))).toBe('Marks are not saved: the Vost server cannot be reached');
    expect(whyNotSaved(new TypeError('Failed to fetch'))).toBe('Marks are not saved: the Vost server cannot be reached');
  });
});
