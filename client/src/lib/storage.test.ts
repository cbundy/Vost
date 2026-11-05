import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  KEEPALIVE_LIMIT,
  OUTAGE_GRACE_MS,
  UNREACHABLE,
  debounce,
  flushStorage,
  hydrate,
  loadJson,
  onStorageOutage,
  peekJson,
  removeKey,
  resetStorageForTest,
  saveJson,
  seedStorageForTest,
  setStorageTransportForTest,
  storageHasPending,
  takeMigrationNotice,
  type StorageOutageEvent,
  type StorageTransport,
} from './storage';

interface Call {
  method: string;
  url: string;
  body?: string;
  contentType?: string;
  keepalive?: boolean;
}
/** A server double that records requests and answers from a script (default: 204 for writes, the given values for the list). */
function fakeServer(answer: (c: Call) => { status: number; body?: unknown } | 'network' = () => ({ status: 204 })) {
  const calls: Call[] = [];
  const transport: StorageTransport = async (url, init) => {
    const headers = init.headers as Record<string, string> | undefined;
    const call: Call = { method: init.method ?? 'GET', url, body: init.body as string | undefined, contentType: headers?.['content-type'], keepalive: init.keepalive };
    calls.push(call);
    const r = answer(call);
    if (r === 'network') throw new TypeError('Failed to fetch');
    return { status: r.status, json: async () => r.body };
  };
  setStorageTransportForTest(transport);
  return calls;
}
const flushMicrotasks = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

beforeEach(() => seedStorageForTest());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetStorageForTest();
});

describe('hydrate', () => {
  it('fills the cache from GET /api/settings', async () => {
    const calls = fakeServer((c) => (c.method === 'GET' ? { status: 200, body: { values: { 'prefs.v1': { a: 1 }, flag: true } } } : { status: 204 }));
    await hydrate();
    expect(calls).toMatchObject([{ method: 'GET', url: '/api/settings' }]);
    expect(loadJson('prefs.v1', null)).toEqual({ a: 1 });
    expect(loadJson('flag', false)).toBe(true);
    expect(loadJson('missing', 'fb')).toBe('fb');
    expect(peekJson('missing')).toEqual({ ok: true, value: null });
    expect(peekJson('flag')).toEqual({ ok: true, value: true });
  });

  it('rejects when the server cannot be reached or answers an error', async () => {
    fakeServer(() => 'network');
    await expect(hydrate()).rejects.toThrow();
    fakeServer(() => ({ status: 500 }));
    await expect(hydrate()).rejects.toThrow(/500/);
  });

  it('runs again after a failure (Retry)', async () => {
    let up = false;
    const calls = fakeServer(() => (up ? { status: 200, body: { values: { x: 1 } } } : { status: 502 }));
    await expect(hydrate()).rejects.toThrow();
    up = true;
    await hydrate();
    expect(calls).toHaveLength(2);
    expect(loadJson('x', 0)).toBe(1);
  });
});

describe('writes', () => {
  it('coalesces quick saves of one key into one PUT with the last value, JSON content type', async () => {
    const calls = fakeServer();
    saveJson('prefs.v1', { n: 1 });
    saveJson('prefs.v1', { n: 2 });
    saveJson('prefs.v1', { n: 3 });
    expect(loadJson('prefs.v1', null)).toEqual({ n: 3 });
    await flushMicrotasks();
    expect(calls).toEqual([{ method: 'PUT', url: '/api/settings/prefs.v1', body: '{"n":3}', contentType: 'application/json', keepalive: undefined }]);
    expect(storageHasPending()).toBe(false);
  });

  it('keeps the order of different keys', async () => {
    const calls = fakeServer();
    saveJson('b', 1);
    saveJson('a', 2);
    saveJson('b', 3);
    await flushMicrotasks();
    expect(calls.map((c) => c.url)).toEqual(['/api/settings/b', '/api/settings/a']);
    expect(calls.every((c) => c.contentType === 'application/json')).toBe(true);
  });

  it('sends one request at a time per key, then the newest value', async () => {
    let release: (() => void) | undefined;
    const calls: Call[] = [];
    setStorageTransportForTest(async (url, init) => {
      calls.push({ method: init.method!, url, body: init.body as string | undefined });
      if (calls.length === 1) await new Promise<void>((r) => (release = r));
      return { status: 204, json: async () => null };
    });
    saveJson('k', 1);
    await flushMicrotasks();
    saveJson('k', 2);
    saveJson('k', 3);
    await flushMicrotasks();
    expect(calls.map((c) => c.body)).toEqual(['1']);
    release!();
    await flushMicrotasks();
    expect(calls.map((c) => c.body)).toEqual(['1', '3']);
  });

  it('removeKey sends DELETE (with the JSON content type) only for a cached key, and a 404 counts as done', async () => {
    seedStorageForTest({ here: 1 });
    const calls = fakeServer((c) => ({ status: c.method === 'DELETE' ? 404 : 204 }));
    removeKey('never');
    removeKey('here');
    await flushMicrotasks();
    expect(calls).toEqual([{ method: 'DELETE', url: '/api/settings/here', body: undefined, contentType: 'application/json', keepalive: undefined }]);
    expect(loadJson('here', 'gone')).toBe('gone');
    expect(storageHasPending()).toBe(false);
  });

  it('saveJson reports ok even though the write is queued', () => {
    fakeServer();
    expect(saveJson('k', { a: 1 })).toEqual({ ok: true });
  });
});

describe('outage', () => {
  const events: StorageOutageEvent[] = [];
  beforeEach(() => {
    vi.useFakeTimers();
    events.length = 0;
    onStorageOutage((e) => events.push(e));
  });

  it('retries a failing PUT with backoff, reports one outage and clears it when the queue drains', async () => {
    let fails = 3;
    const calls = fakeServer(() => (fails-- > 0 ? 'network' : { status: 204 }));
    saveJson('k', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    expect(events).toEqual([{ kind: 'down', message: UNREACHABLE }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls).toHaveLength(3);
    expect(events).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(calls).toHaveLength(4);
    expect(events).toEqual([{ kind: 'down', message: UNREACHABLE }, { kind: 'up' }]);
    expect(storageHasPending()).toBe(false);
  });

  it('retries a 5xx but passes a 503 reason on', async () => {
    let n = 0;
    fakeServer(() => (n++ === 0 ? { status: 503, body: { error: 'Settings cannot be saved: the data folder is not writable.' } } : { status: 204 }));
    saveJson('k', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([{ kind: 'down', message: 'Settings cannot be saved: the data folder is not writable.' }]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(events.at(-1)).toEqual({ kind: 'up' });
  });

  it('caps the backoff', async () => {
    const calls = fakeServer(() => 'network');
    saveJson('k', 1);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    // 1+2+4+8+16 s, then every 30 s
    expect(calls.length).toBeGreaterThan(20);
    expect(events).toHaveLength(1);
  });

  it('does not retry a 4xx: it is logged and reported once, and the queue moves on', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls = fakeServer(() => ({ status: 415 }));
    saveJson('k', 1);
    await vi.advanceTimersByTimeAsync(60000);
    expect(calls).toHaveLength(1);
    expect(events).toEqual([{ kind: 'rejected', message: 'Setting k was refused by the server (415)' }]);
    expect(err).toHaveBeenCalledTimes(1);
    expect(storageHasPending()).toBe(false);
    err.mockRestore();
  });

  it('a write pending past the grace period counts as an outage', async () => {
    setStorageTransportForTest(() => new Promise(() => {}));
    saveJson('k', 1);
    await vi.advanceTimersByTimeAsync(OUTAGE_GRACE_MS - 1);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual([{ kind: 'down', message: UNREACHABLE }]);
  });
});

describe('page-hide flush', () => {
  it('uses keepalive while the pending bodies fit 64 KB together', async () => {
    const calls = fakeServer();
    saveJson('a', 'x'.repeat(1000));
    saveJson('b', 'y'.repeat(1000));
    flushStorage();
    await flushMicrotasks();
    expect(calls.map((c) => c.keepalive)).toEqual([true, true]);
  });

  it('sends normal requests when the bodies together are over the limit', async () => {
    const calls = fakeServer();
    saveJson('a', 'x'.repeat(KEEPALIVE_LIMIT / 2 + 10));
    saveJson('b', 'y'.repeat(KEEPALIVE_LIMIT / 2 + 10));
    flushStorage();
    await flushMicrotasks();
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.keepalive)).toEqual([undefined, undefined]);
  });

  it('sends a write that is waiting for a retry now', async () => {
    vi.useFakeTimers();
    let up = false;
    const calls = fakeServer(() => (up ? { status: 204 } : 'network'));
    saveJson('a', 1);
    await vi.advanceTimersByTimeAsync(0);
    up = true;
    flushStorage();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(2);
    expect(calls[1].keepalive).toBe(true);
    expect(storageHasPending()).toBe(false);
  });
});

describe('migration of old browser data', () => {
  function fakeBrowser(initial: Record<string, string>) {
    const store = new Map(Object.entries(initial));
    vi.stubGlobal('localStorage', {
      get length() {
        return store.size;
      },
      key: (i: number) => [...store.keys()][i] ?? null,
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    return store;
  }
  const answers = (import_: (c: Call) => { status: number; body?: unknown } | 'network') => (c: Call) =>
    c.method === 'POST' ? import_(c) : { status: 200, body: { values: { 'prefs.v1': { fromServer: true } } } };

  it('posts every vost.* key without the prefix, skips unparsable ones, removes only what the server took', async () => {
    const store = fakeBrowser({ 'vost.prefs.v1': '{"a":1}', 'vost.watchlists.v1': '[1]', 'vost.broken': '{nope', other: '"keep"' });
    const calls = fakeServer(answers(() => ({ status: 200, body: { adopted: ['prefs.v1'], archived: ['watchlists.v1'], file: 'settings-imported-1.json' } })));
    await hydrate();
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST /api/settings/import', 'GET /api/settings']);
    expect(calls[0].contentType).toBe('application/json');
    expect(JSON.parse(calls[0].body!)).toEqual({ values: { 'prefs.v1': { a: 1 }, 'watchlists.v1': [1] } });
    expect([...store.keys()].sort()).toEqual(['other', 'vost.broken']);
    expect(takeMigrationNotice()).toEqual({ adopted: 1, archived: 1, file: 'settings-imported-1.json' });
    expect(takeMigrationNotice()).toBeNull();
    expect(loadJson('prefs.v1', null)).toEqual({ fromServer: true });
  });

  it('keeps every key when the import fails, is retried next start, and does not block start-up', async () => {
    for (const failure of [{ status: 500 }, { status: 400, body: { error: 'x' } }, 'network' as const]) {
      const store = fakeBrowser({ 'vost.prefs.v1': '{"a":1}', 'vost.layout.v1': '{}' });
      fakeServer(answers(() => failure));
      await hydrate();
      expect([...store.keys()].sort()).toEqual(['vost.layout.v1', 'vost.prefs.v1']);
      expect(takeMigrationNotice()).toBeNull();
      expect(loadJson('prefs.v1', null)).toEqual({ fromServer: true });
    }
  });

  it('sends nothing when no vost.* key is left', async () => {
    fakeBrowser({ other: '1' });
    const calls = fakeServer(answers(() => ({ status: 500 })));
    await hydrate();
    expect(calls.map((c) => c.method)).toEqual(['GET']);
  });

  it('a start with the server down leaves the browser data and rejects', async () => {
    const store = fakeBrowser({ 'vost.prefs.v1': '{"a":1}' });
    fakeServer(() => 'network');
    await expect(hydrate()).rejects.toThrow();
    expect([...store.keys()]).toEqual(['vost.prefs.v1']);
  });
});

describe('debounce', () => {
  afterEach(() => vi.useRealTimers());

  it('fires after wait with the last args', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(1);
    d(2);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
  });

  it('flush runs the pending call once, now', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(1);
    d(2);
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(2);
    d.flush();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('cancel drops the pending call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d(1);
    d.cancel();
    d.flush();
    vi.advanceTimersByTime(500);
    expect(fn).not.toHaveBeenCalled();
  });
});
