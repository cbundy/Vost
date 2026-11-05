import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DB_NAME,
  GRACE_MS,
  ImageError,
  MAX_IMAGE_BYTES,
  MESSAGES,
  available,
  count,
  createSweeper,
  getImage,
  inTabRefs,
  migrateBrowserImages,
  putImage,
  registerImageRefs,
  setImageTransport,
  sniffType,
  sweep,
  sweepAll,
  totalSize,
  type ImageResponse,
} from './drawingImages';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const GIF = [...'GIF89a'].map((c) => c.charCodeAt(0));
const WEBP = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0)));

/** A file of `size` bytes that starts with `magic`; the rest differs by `salt` so two files hash differently. */
function file(type: string, magic: readonly number[], size = 64, salt = 0): File {
  const bytes = new Uint8Array(size);
  bytes.set(magic);
  bytes[size - 1] = salt;
  return new File([bytes], 'x', { type });
}
const decode = async () => ({ w: 40, h: 30 });
const png = (salt = 0, size = 64) => file('image/png', PNG, size, salt);
const NOW = 1_000_000_000_000;

const hex = async (b: ArrayBuffer) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', b))].map((x) => x.toString(16).padStart(2, '0')).join('');

type Call = { method: string; url: string; headers?: Record<string, string>; body?: unknown };

/** A stand-in for the Vost server's picture service: it checks the key against the bytes and keeps what it is given. */
class FakeServer {
  pictures = new Map<string, { blob: Blob; w: number; h: number; seenAt: number }>();
  calls: Call[] = [];
  writable = true;
  /** Statuses the next PUTs answer instead of the real answer. */
  putOverride: number[] = [];
  sweepRemoves: string[] = [];
  down = false;
  limit = Infinity;

  reply = (status: number, body: unknown = {}, blob?: Blob): ImageResponse => ({ status, json: async () => body, blob: async () => blob ?? new Blob() });

  transport = async (url: string, init: RequestInit = {}): Promise<ImageResponse> => {
    const method = init.method ?? 'GET';
    this.calls.push({ method, url, headers: init.headers as Record<string, string> | undefined, body: init.body });
    if (this.down) throw new TypeError('network down');
    if (url === '/api/images') return this.reply(200, { count: this.pictures.size, bytes: [...this.pictures.values()].reduce((n, p) => n + p.blob.size, 0), writable: this.writable });
    if (url === '/api/images/sweep') {
      const refs = JSON.parse(init.body as string).refs as string[];
      for (const k of refs) if (this.pictures.has(k)) this.pictures.get(k)!.seenAt = Date.now();
      for (const k of this.sweepRemoves) this.pictures.delete(k);
      return this.reply(200, { removed: this.sweepRemoves });
    }
    const m = /^\/api\/images\/([0-9a-f]{64})(\?w=(\d+)&h=(\d+))?$/.exec(url);
    if (!m) return this.reply(404);
    if (method === 'GET') {
      const p = this.pictures.get(m[1]);
      return p ? this.reply(200, {}, p.blob) : this.reply(404, { error: 'No such picture' });
    }
    const forced = this.putOverride.shift();
    if (forced) return this.reply(forced, { error: 'forced' });
    const bytes = await new Blob([init.body as BlobPart]).arrayBuffer();
    if ((await hex(bytes)) !== m[1]) return this.reply(400);
    const have = this.pictures.get(m[1]);
    if (have) return this.reply(200, { key: m[1], w: have.w, h: have.h });
    if (bytes.byteLength > this.limit) return this.reply(507, { code: 'store' });
    const type = (init.headers as Record<string, string>)['content-type'];
    this.pictures.set(m[1], { blob: new Blob([bytes], { type }), w: Number(m[3]), h: Number(m[4]), seenAt: Date.now() });
    return this.reply(201, { key: m[1], w: Number(m[3]), h: Number(m[4]) });
  };
}

let server: FakeServer;

beforeEach(() => {
  server = new FakeServer();
  setImageTransport(server.transport);
});
afterEach(() => {
  setImageTransport(null);
  vi.restoreAllMocks();
});

describe('putImage', () => {
  it('uploads a picture under its hash and gives it back with its natural size', async () => {
    const f = png(1);
    const got = await putImage(f, { decode });
    expect(got).toMatchObject({ w: 40, h: 30 });
    expect(got.key).toMatch(/^[0-9a-f]{64}$/);
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0]).toMatchObject({ method: 'PUT', url: `/api/images/${got.key}?w=40&h=30`, headers: { 'content-type': 'image/png' } });
    const rec = await getImage(got.key);
    expect(rec).toMatchObject({ key: got.key, type: 'image/png', size: 64 });
    expect(rec!.blob.size).toBe(64);
    expect(await getImage('0'.repeat(64))).toBeNull();
  });

  it('stores the same bytes once, answering with the size the server holds', async () => {
    const a = await putImage(png(2), { decode });
    const b = await putImage(png(2), { decode: async () => ({ w: 9, h: 9 }) });
    expect(b).toEqual(a);
    expect(await count()).toBe(1);
    await putImage(png(3), { decode });
    expect(await count()).toBe(2);
  });

  it('accepts PNG, JPEG, GIF and WebP by type and magic bytes', async () => {
    for (const [type, magic] of [['image/png', PNG], ['image/jpeg', JPEG], ['image/gif', GIF], ['image/webp', WEBP]] as const) {
      await expect(putImage(file(type, magic), { decode })).resolves.toMatchObject({ w: 40 });
    }
    expect(sniffType(new Uint8Array(JPEG))).toBe('image/jpeg');
    expect(sniffType(new Uint8Array(12))).toBeNull();
  });

  it('refuses a file whose type or bytes are not a picture, before any request', async () => {
    const refusals = [
      new File(['hello'], 'a.txt', { type: 'text/plain' }),
      file('image/png', [1, 2, 3, 4, 5, 6, 7, 8, 9]), // PNG-typed garbage
      file('image/png', JPEG), // a JPEG called PNG
      file('image/gif', [...'GIF86a'].map((c) => c.charCodeAt(0))),
      file('image/webp', [...'RIFF'].map((c) => c.charCodeAt(0))), // RIFF but not WEBP
      file('image/svg+xml', [...'<svg'].map((c) => c.charCodeAt(0))),
    ];
    for (const f of refusals) {
      await expect(putImage(f, { decode })).rejects.toMatchObject({ code: 'type', message: 'Only PNG, JPEG, GIF or WebP pictures can be added.' });
    }
    expect(server.calls).toEqual([]);
  });

  it('refuses a file over 5 MB with the limit in the message, before any request', async () => {
    const err = await putImage(png(0, MAX_IMAGE_BYTES + 1), { decode }).catch((e) => e);
    expect(err).toBeInstanceOf(ImageError);
    expect(err.code).toBe('size');
    expect(err.message).toContain('5 MB');
    expect(server.calls).toEqual([]);
    await expect(putImage(png(0, MAX_IMAGE_BYTES), { decode })).resolves.toBeDefined();
    expect(await count()).toBe(1);
  });

  it('refuses a picture that does not decode, or whose size is out of range, before any request', async () => {
    await expect(putImage(png(5), { decode: async () => Promise.reject(new Error('bad')) })).rejects.toMatchObject({ code: 'decode' });
    await expect(putImage(png(6), { decode: async () => ({ w: 0, h: 5 }) })).rejects.toMatchObject({ code: 'decode' });
    await expect(putImage(png(7), { decode: async () => ({ w: 16385, h: 5 }) })).rejects.toMatchObject({ code: 'decode' });
    expect(server.calls).toEqual([]);
  });

  it('runs the sweep once on a full store (507) and uploads again', async () => {
    server.putOverride = [507];
    const sweepFn = vi.fn(async () => undefined);
    const got = await putImage(png(10), { decode, sweep: sweepFn });
    expect(sweepFn).toHaveBeenCalledTimes(1);
    expect(got.key).toBeDefined();
    expect(server.calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
    expect(await count()).toBe(1);
  });

  it('throws store (with the 50 MB limit in the message) when the second upload is full too', async () => {
    server.putOverride = [507, 507];
    const sweepFn = vi.fn(async () => undefined);
    const err = await putImage(png(11), { decode, sweep: sweepFn }).catch((e) => e);
    expect(err).toBeInstanceOf(ImageError);
    expect(err.code).toBe('store');
    expect(err.message).toContain('50 MB');
    expect(sweepFn).toHaveBeenCalledTimes(1);
    expect(server.calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
  });

  it('maps the server replies to the messages', async () => {
    for (const [status, code] of [[413, 'size'], [415, 'type'], [400, 'decode'], [503, 'unavailable'], [500, 'unavailable']] as const) {
      server.putOverride = [status];
      const err = await putImage(png(20 + status), { decode }).catch((e) => e);
      expect(err).toMatchObject({ code, message: MESSAGES[code] });
    }
    server.down = true;
    await expect(putImage(png(30), { decode })).rejects.toMatchObject({ code: 'unavailable', message: MESSAGES.unavailable });
  });
});

describe('getImage, available, totalSize', () => {
  it('getImage gives null on 404 and on a network error', async () => {
    const { key } = await putImage(png(1), { decode });
    expect(await getImage(key)).not.toBeNull();
    expect(await getImage('1'.repeat(64))).toBeNull();
    expect(await getImage('not-a-key')).toBeNull();
    server.down = true;
    expect(await getImage(key)).toBeNull();
  });

  it('available is true only when the server answers and can write', async () => {
    expect(await available()).toBe(true);
    server.writable = false;
    expect(await available()).toBe(false);
    server.writable = true;
    server.down = true;
    expect(await available()).toBe(false);
  });

  it('totalSize and count read the server', async () => {
    await putImage(png(1, 100), { decode });
    await putImage(png(2, 50), { decode });
    expect(await totalSize()).toBe(150);
    expect(await count()).toBe(2);
    server.down = true;
    await expect(count()).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('sweep', () => {
  const none = () => ({ keys: new Set<string>(), newer: false });
  const sweepBody = () => JSON.parse(server.calls.filter((c) => c.url === '/api/images/sweep').at(-1)!.body as string).refs as string[];

  it('posts the references and returns the removed keys', async () => {
    server.sweepRemoves = ['f'.repeat(64)];
    expect(await sweep(new Set(['a'.repeat(64)]), NOW)).toEqual(['f'.repeat(64)]);
    expect(sweepBody()).toEqual(['a'.repeat(64)]);
    expect(server.calls.at(-1)).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } });
  });

  it('sweepAll sends the persisted references and the in-tab ones together', async () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const unregister = registerImageRefs(() => [b]);
    expect(inTabRefs().has(b)).toBe(true);
    await sweepAll(() => ({ keys: new Set([a]), newer: false }), NOW + GRACE_MS);
    expect(sweepBody().sort()).toEqual([a, b]);
    unregister();
    expect(inTabRefs().has(b)).toBe(false);
    await sweepAll(none, NOW);
    expect(sweepBody()).toEqual([]);
  });

  it('sweepAll does nothing when the persisted drawings are from a newer app or unreadable', async () => {
    server.calls = [];
    expect(await sweepAll(() => ({ keys: new Set(), newer: true }), NOW)).toBeNull();
    expect(await sweepAll(() => null, NOW)).toBeNull();
    expect(server.calls).toEqual([]);
  });

  it('fails with unavailable when the server cannot be reached', async () => {
    server.down = true;
    await expect(sweep(new Set(), NOW)).rejects.toMatchObject({ code: 'unavailable' });
  });
});

describe('migrateBrowserImages', () => {
  const dbNames = async () => (await indexedDB.databases()).map((d) => d.name);

  /** Seeds `vost-images` the way v0.12 left it. */
  async function seed(records: { type: string; magic: readonly number[]; salt: number; w: number; h: number }[]): Promise<string[]> {
    const keys: string[] = [];
    const rows: unknown[] = [];
    for (const r of records) {
      const f = file(r.type, r.magic, 64, r.salt);
      const bytes = await f.arrayBuffer();
      const key = await hex(bytes);
      keys.push(key);
      rows.push({ key, blob: new Blob([bytes], { type: r.type }), type: r.type, size: 64, w: r.w, h: r.h, addedAt: 1, seenAt: 1 });
    }
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore('images', { keyPath: 'key' });
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('images', 'readwrite');
        for (const row of rows) tx.objectStore('images').put(row);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
      };
    });
    return keys;
  }
  const drop = () =>
    new Promise<void>((resolve) => {
      const r = indexedDB.deleteDatabase(DB_NAME);
      r.onsuccess = r.onerror = () => resolve();
    });
  beforeEach(drop);
  afterEach(drop);

  it('uploads each record with its stored size, then deletes the database', async () => {
    const keys = await seed([
      { type: 'image/png', magic: PNG, salt: 1, w: 100, h: 50 },
      { type: 'image/jpeg', magic: JPEG, salt: 2, w: 7, h: 8 },
    ]);
    await migrateBrowserImages();
    expect(server.pictures.get(keys[0])).toMatchObject({ w: 100, h: 50 });
    expect(server.pictures.get(keys[1])).toMatchObject({ w: 7, h: 8 });
    expect(await dbNames()).not.toContain(DB_NAME);
  });

  it('keeps the database on a 503 and retries on the next call', async () => {
    const keys = await seed([{ type: 'image/png', magic: PNG, salt: 1, w: 3, h: 3 }]);
    server.putOverride = [503];
    await migrateBrowserImages();
    expect(await dbNames()).toContain(DB_NAME);
    expect(server.pictures.size).toBe(0);
    await migrateBrowserImages();
    expect(server.pictures.has(keys[0])).toBe(true);
    expect(await dbNames()).not.toContain(DB_NAME);
  });

  it('keeps the database while the server is unreachable', async () => {
    await seed([{ type: 'image/png', magic: PNG, salt: 1, w: 3, h: 3 }]);
    server.down = true;
    await migrateBrowserImages();
    expect(await dbNames()).toContain(DB_NAME);
  });

  it('skips a picture the server will always refuse and still moves the rest', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const keys = await seed([
      { type: 'image/png', magic: PNG, salt: 1, w: 3, h: 3 },
      { type: 'image/gif', magic: GIF, salt: 2, w: 4, h: 4 },
    ]);
    server.putOverride = [415];
    await migrateBrowserImages();
    // the records come back in key order: the first one the server refused is skipped, the other is moved
    expect(keys.filter((k) => server.pictures.has(k))).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await dbNames()).not.toContain(DB_NAME);
  });

  it('uploads nothing and creates no database when there is none', async () => {
    await migrateBrowserImages();
    expect(server.calls).toEqual([]);
    expect(await dbNames()).toEqual([]);
  });

  it('without indexedDB.databases() it creates no database when there is none, and still finds one that exists', async () => {
    const databases = indexedDB.databases;
    Object.defineProperty(indexedDB, 'databases', { value: undefined, configurable: true, writable: true });
    try {
      await migrateBrowserImages();
      expect(server.calls).toEqual([]);
      const keys = await seed([{ type: 'image/png', magic: PNG, salt: 1, w: 3, h: 3 }]);
      await migrateBrowserImages();
      expect(server.pictures.has(keys[0])).toBe(true);
    } finally {
      Object.defineProperty(indexedDB, 'databases', { value: databases, configurable: true, writable: true });
    }
    expect(await dbNames()).toEqual([]);
  });
});

describe('createSweeper', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('debounces calls into one sweep and never runs two at once', async () => {
    let calls = 0;
    const sweeper = createSweeper(() => {
      calls++;
      return { keys: new Set(), newer: false };
    }, 100, () => NOW);
    sweeper.schedule();
    sweeper.schedule();
    sweeper.schedule();
    expect(calls).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(calls).toBe(1);
    const first = sweeper.run();
    const second = sweeper.run();
    expect(await second).toBeNull();
    await first;
  });
});
