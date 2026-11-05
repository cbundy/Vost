import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { batchSets, DB_NAME, migrateBrowserData, SETS, SETTINGS, type MigrateTransport } from './migrate';
import { openStore } from './store';

const set = (id: string, pad = 0) => ({ id, version: 1, trades: [], updatedAt: 1, pad: 'x'.repeat(pad) });
const inputs = { id: 'find-inputs', version: 1, form: { direction: 'both' } };
const model = { id: 'model', version: 1 };

/** Creates the old database as the given version left it. */
async function seed(version: 1 | 2, sets: unknown[], settings: unknown[] = []): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(SETS, { keyPath: 'id' });
      if (version === 2) req.result.createObjectStore(SETTINGS, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = db.transaction(version === 2 ? [SETS, SETTINGS] : [SETS], 'readwrite');
  for (const s of sets) tx.objectStore(SETS).put(s);
  for (const s of settings) tx.objectStore(SETTINGS).put(s);
  await new Promise<void>((r) => (tx.oncomplete = () => r()));
  db.close();
}

const exists = async (): Promise<boolean> => (await indexedDB.databases()).some((d) => d.name === DB_NAME);

interface Sent {
  sets: Array<{ id: string }>;
  inputs: unknown;
  model: unknown;
}
function recorder(statuses: number[] = [], file: string | null = null): { transport: MigrateTransport; sent: Sent[]; urls: string[] } {
  const sent: Sent[] = [];
  const urls: string[] = [];
  return {
    sent,
    urls,
    transport: async (url, init) => {
      urls.push(url);
      sent.push(JSON.parse(init.body as string));
      const status = statuses[sent.length - 1] ?? 200;
      return { status, json: async () => ({ adopted: [], present: [], archived: [], file }) };
    },
  };
}

afterEach(async () => {
  await new Promise<void>((r) => {
    const q = indexedDB.deleteDatabase(DB_NAME);
    q.onsuccess = q.onerror = q.onblocked = () => r();
  });
});

describe('migrateBrowserData', () => {
  it('sends every record of a version 2 database, then deletes it', async () => {
    await seed(2, [set('a'), set('b')], [inputs, model]);
    const r = recorder();
    expect(await migrateBrowserData(r.transport)).toEqual({ sets: 2, files: [] });
    expect(r.urls).toEqual(['/api/strategy-maker/migrate']);
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]!.sets.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(r.sent[0]!.inputs).toEqual(inputs);
    expect(r.sent[0]!.model).toEqual(model);
    expect(await exists()).toBe(false);
  });

  it('moves a version 1 database (sets only)', async () => {
    await seed(1, [set('a')]);
    const r = recorder();
    expect(await migrateBrowserData(r.transport)).toEqual({ sets: 1, files: [] });
    expect(r.sent[0]).toMatchObject({ inputs: null, model: null });
    expect(await exists()).toBe(false);
  });

  it('moves a database that holds only the form and the model', async () => {
    await seed(2, [], [inputs, model]);
    const r = recorder();
    expect(await migrateBrowserData(r.transport)).toEqual({ sets: 0, files: [] });
    expect(r.sent[0]).toMatchObject({ sets: [], inputs, model });
    expect(await exists()).toBe(false);
  });

  it('names the archive file the server wrote', async () => {
    await seed(2, [set('a')]);
    expect(await migrateBrowserData(recorder([], 'strategy-maker-imported-5.json').transport)).toEqual({ sets: 1, files: ['strategy-maker-imported-5.json'] });
  });

  it('with no database asks nothing and creates none', async () => {
    const r = recorder();
    expect(await migrateBrowserData(r.transport)).toBeNull();
    expect(r.sent).toEqual([]);
    expect(await exists()).toBe(false);
  });

  it('without indexedDB.databases() still creates no database, and still finds one', async () => {
    Object.defineProperty(indexedDB, 'databases', { value: undefined, configurable: true });
    try {
      const r = recorder();
      expect(await migrateBrowserData(r.transport)).toBeNull();
      expect(r.sent).toEqual([]);
      await seed(2, [set('a')]);
      expect(await migrateBrowserData(r.transport)).toEqual({ sets: 1, files: [] });
    } finally {
      Reflect.deleteProperty(indexedDB, 'databases');
    }
    expect(await exists()).toBe(false);
  });

  it('keeps the database whole when the server fails, and a later visit finishes the move', async () => {
    await seed(2, [set('a')], [inputs]);
    expect(await migrateBrowserData(recorder([503]).transport)).toBeNull();
    expect(await exists()).toBe(true);
    const throwing: MigrateTransport = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await migrateBrowserData(throwing)).toBeNull();
    expect(await exists()).toBe(true);
    const r = recorder();
    expect(await migrateBrowserData(r.transport)).toEqual({ sets: 1, files: [] });
    expect(r.sent[0]!.sets).toHaveLength(1);
    expect(await exists()).toBe(false);
  });

  it('sends batches under the cap, the form and model last, and keeps the database if any batch fails', async () => {
    const pad = 3 * 1024 * 1024;
    await seed(2, [set('a', pad), set('b', pad), set('c', pad), set('d', pad), set('e', pad), set('f', pad)], [inputs, model]);
    const fail = recorder([200, 503]);
    expect(await migrateBrowserData(fail.transport)).toBeNull();
    expect(fail.sent).toHaveLength(2);
    expect(await exists()).toBe(true);

    const ok = recorder();
    expect(await migrateBrowserData(ok.transport)).toEqual({ sets: 6, files: [] });
    expect(ok.sent.length).toBeGreaterThan(1);
    for (const b of ok.sent) expect(JSON.stringify(b).length).toBeLessThan(16 * 1024 * 1024 + 1024);
    expect(ok.sent.flatMap((b) => b.sets).map((s) => s.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(ok.sent.slice(0, -1).every((b) => b.inputs === null && b.model === null)).toBe(true);
    expect(ok.sent.at(-1)).toMatchObject({ inputs, model });
    expect(await exists()).toBe(false);
  }, 30000);

  it('openStore runs it first and reports the move', async () => {
    await seed(2, [set('a')]);
    const r = recorder();
    const seen: unknown[] = [];
    const store = await openStore({
      transport: async (url, init) => (url.endsWith('/migrate') ? r.transport(url, init) : { status: 404, json: async () => ({}) }),
      onMoved: (n) => seen.push(n),
    });
    expect(store).not.toBeNull();
    expect(seen).toEqual([{ sets: 1, files: [] }]);
    expect(await exists()).toBe(false);
  });
});

describe('batchSets', () => {
  it('splits by size and lets one big set go alone', () => {
    const big = set('big', 100);
    expect(batchSets([], 50)).toEqual([]);
    expect(batchSets([big], 50)).toEqual([[big]]);
    expect(batchSets([set('a'), set('b'), big, set('c')], big.pad.length + 200).map((b) => b.length)).toEqual([3, 1]);
  });
});
