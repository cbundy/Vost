import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DB_NAME,
  GRACE_MS,
  ImageError,
  MAX_IMAGE_BYTES,
  MAX_STORE_BYTES,
  MESSAGES,
  available,
  closeDb,
  count,
  createSweeper,
  getImage,
  inTabRefs,
  putImage,
  registerImageRefs,
  sniffType,
  sweep,
  sweepAll,
  totalSize,
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

beforeEach(async () => {
  await closeDb();
  await new Promise<void>((resolve) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = r.onerror = () => resolve();
  });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('putImage', () => {
  it('stores a picture and gives it back with its natural size', async () => {
    const f = png(1);
    const got = await putImage(f, { decode, now: NOW });
    expect(got).toMatchObject({ w: 40, h: 30 });
    expect(got.key).toMatch(/^[0-9a-f]{64}$/);
    const rec = await getImage(got.key);
    expect(rec).toMatchObject({ key: got.key, type: 'image/png', size: 64, w: 40, h: 30, addedAt: NOW, seenAt: NOW });
    expect(rec!.blob.size).toBe(64);
    expect(await getImage('0'.repeat(64))).toBeNull();
  });

  it('stores the same bytes once, refreshing when it was last seen', async () => {
    const a = await putImage(png(2), { decode, now: NOW });
    const b = await putImage(png(2), { decode, now: NOW + 5 });
    expect(b).toEqual(a);
    expect(await count()).toBe(1);
    expect((await getImage(a.key))!.seenAt).toBe(NOW + 5);
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

  it('refuses a file whose type or bytes are not a picture, adding nothing', async () => {
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
    expect(await count()).toBe(0);
  });

  it('refuses a file over 5 MB with the limit in the message', async () => {
    const err = await putImage(png(0, MAX_IMAGE_BYTES + 1), { decode }).catch((e) => e);
    expect(err).toBeInstanceOf(ImageError);
    expect(err.code).toBe('size');
    expect(err.message).toContain('5 MB');
    await expect(putImage(png(0, MAX_IMAGE_BYTES), { decode })).resolves.toBeDefined();
    expect(await count()).toBe(1);
  });

  it('refuses a picture that would take the store past 50 MB (after one sweep) with the limit in the message', async () => {
    for (let i = 0; i < 10; i++) await putImage(png(i + 1, MAX_IMAGE_BYTES), { decode, now: NOW });
    expect(await totalSize()).toBe(10 * MAX_IMAGE_BYTES);
    const sweepFn = vi.fn(async () => undefined);
    const err = await putImage(png(99), { decode, sweep: sweepFn }).catch((e) => e);
    expect(err.code).toBe('store');
    expect(err.message).toContain('50 MB');
    expect(sweepFn).toHaveBeenCalledTimes(1);
    expect(await count()).toBe(10);
    expect(MAX_STORE_BYTES).toBe(10 * MAX_IMAGE_BYTES);
  });

  it('frees room with the sweep when the store is full of pictures nothing uses', async () => {
    for (let i = 0; i < 10; i++) await putImage(png(i + 1, MAX_IMAGE_BYTES), { decode, now: NOW });
    const got = await putImage(png(99), { decode, now: NOW + GRACE_MS + 1, sweep: () => sweep(new Set(), NOW + GRACE_MS + 1) });
    expect(got.key).toBeDefined();
    expect(await count()).toBe(1);
  });

  it('refuses a picture that does not decode, or whose size is out of range', async () => {
    await expect(putImage(png(5), { decode: async () => Promise.reject(new Error('bad')) })).rejects.toMatchObject({ code: 'decode' });
    await expect(putImage(png(6), { decode: async () => ({ w: 0, h: 5 }) })).rejects.toMatchObject({ code: 'decode' });
    await expect(putImage(png(7), { decode: async () => ({ w: 16385, h: 5 }) })).rejects.toMatchObject({ code: 'decode' });
    expect(await count()).toBe(0);
  });
});

describe('available', () => {
  it('is true when the database opens and false when indexedDB.open throws', async () => {
    expect(await available()).toBe(true);
    await closeDb();
    vi.spyOn(indexedDB, 'open').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(await available()).toBe(false);
    await expect(putImage(png(8), { decode })).rejects.toMatchObject({ code: 'unavailable', message: MESSAGES.unavailable });
    expect(await getImage('0'.repeat(64))).toBeNull();
  });
});

describe('sweep', () => {
  const put = (salt: number, now = NOW) => putImage(png(salt), { decode, now });
  const later = NOW + GRACE_MS + 1;
  const keys = async (...salts: number[]) => (await Promise.all(salts.map((s) => put(s)))).map((r) => r.key);

  it('keeps a picture only a registered in-tab history snapshot (past or future) refers to', async () => {
    const [k] = await keys(1);
    const unregister = registerImageRefs(() => [k]);
    expect(inTabRefs().has(k)).toBe(true);
    expect(await sweepAll(() => ({ keys: new Set(), newer: false }), later)).toEqual([]);
    expect(await getImage(k)).not.toBeNull();
    unregister();
    expect(inTabRefs().has(k)).toBe(false);
    expect(await sweepAll(() => ({ keys: new Set(), newer: false }), later + GRACE_MS + 1)).toEqual([k]);
  });

  it('keeps a picture only the drawing clipboard or a pending placement holds (their sources are registered)', async () => {
    const [clip, pend, gone] = await keys(1, 2, 3);
    const u1 = registerImageRefs(() => [clip]);
    const u2 = registerImageRefs(() => [pend]);
    await sweepAll(() => ({ keys: new Set(), newer: false }), later);
    expect(await getImage(clip)).not.toBeNull();
    expect(await getImage(pend)).not.toBeNull();
    expect(await getImage(gone)).toBeNull();
    u1();
    u2();
  });

  it('keeps a picture a persisted drawing of another source refers to', async () => {
    const [k, other] = await keys(1, 2);
    await sweepAll(() => ({ keys: new Set([k]), newer: false }), later);
    expect(await getImage(k)).not.toBeNull();
    expect(await getImage(other)).toBeNull();
  });

  it('keeps an unreferenced picture inside the grace period and removes it past it', async () => {
    const [k] = await keys(1);
    expect(await sweep(new Set(), NOW + GRACE_MS)).toEqual([]);
    expect(await getImage(k)).not.toBeNull();
    expect(await sweep(new Set(), NOW + GRACE_MS + 1)).toEqual([k]);
    expect(await getImage(k)).toBeNull();
  });

  it('refreshes seenAt of a referenced picture, which restarts its grace', async () => {
    const [k] = await keys(1);
    await sweep(new Set([k]), later);
    expect((await getImage(k))!.seenAt).toBe(later);
    expect(await sweep(new Set(), later + 1000)).toEqual([]);
    expect(await getImage(k)).not.toBeNull();
  });

  it('deletes nothing when the persisted drawings are from a newer app or unreadable', async () => {
    const [k] = await keys(1);
    expect(await sweepAll(() => ({ keys: new Set(), newer: true }), later)).toBeNull();
    expect(await sweepAll(() => null, later)).toBeNull();
    expect(await getImage(k)).not.toBeNull();
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
