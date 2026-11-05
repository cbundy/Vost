import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmod, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleImages, isImagesPath } from './route.ts';
import { createImageStore, GRACE_MS, MAX_IMAGE_BYTES, type ImageStore } from './store.ts';
import { createDocStore, type DocStore } from '../settings/store.ts';

type Reply = Omit<Response, 'json'> & { json(): Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const fetch = (...args: Parameters<typeof globalThis.fetch>): Promise<Reply> => globalThis.fetch(...args) as Promise<Reply>;

let dir = '';
let server: http.Server;
let base = '';
let logs: string[] = [];
let store: ImageStore;
let settings: DocStore;
let clock = 1_000;
let settingsList: DocStore['list'];

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
/** A picture body: starts with `magic`, padded to `size`, `salt` makes the hash differ. */
const body = (magic: Buffer, size = 32, salt = 0): Buffer => {
  const b = Buffer.alloc(size);
  magic.copy(b);
  b[size - 1] = salt;
  return b;
};
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

async function boot(): Promise<void> {
  store = await createImageStore({ dir: path.join(dir, 'images'), log: () => undefined });
  settings = createDocStore({ dir: path.join(dir, 'settings'), log: () => undefined });
  settingsList = () => settings.list();
  const deps = { store, settings: { list: () => settingsList() }, log: (l: string) => logs.push(l), now: () => clock };
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    if (isImagesPath(url.pathname)) void handleImages(req, res, url, deps);
    else res.end('other');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-images-route-'));
  logs = [];
  clock = 1_000;
  await boot();
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  await chmod(dir, 0o755).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

const put = (b: Buffer, opts: { key?: string; type?: string; q?: string; headers?: Record<string, string> } = {}) =>
  fetch(`${base}/api/images/${opts.key ?? sha(b)}?${opts.q ?? 'w=40&h=30'}`, { method: 'PUT', headers: { 'content-type': opts.type ?? 'image/png', ...opts.headers }, body: b });
const sweep = (refs: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/images/sweep`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ refs }) });

describe('PUT /api/images/<key>', () => {
  it('stores a picture (201), answers a re-upload with the stored size (200), and serves the exact bytes', async () => {
    const b = body(PNG, 100, 7);
    const first = await put(b);
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ key: sha(b), w: 40, h: 30 });
    const again = await put(b, { q: 'w=1&h=2' });
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ key: sha(b), w: 40, h: 30 });
    const got = await fetch(`${base}/api/images/${sha(b)}`);
    expect(got.status).toBe(200);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(got.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(got.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Buffer.from(await got.arrayBuffer()).equals(b)).toBe(true);
    expect((await fetch(`${base}/api/images/${'0'.repeat(64)}`)).status).toBe(404);
    expect((await fetch(`${base}/api/images/nope`)).status).toBe(404);
  });

  it('refuses a bad key, a hash mismatch and a bad w or h with 400', async () => {
    const b = body(PNG, 40, 1);
    expect((await put(b, { key: 'ABC' })).status).toBe(400);
    expect((await put(b, { key: 'A'.repeat(64) })).status).toBe(400);
    expect((await put(b, { key: '0'.repeat(64) })).status).toBe(400);
    for (const q of ['w=0&h=5', 'w=5', 'w=5&h=16385', 'w=1.5&h=2', 'w=a&h=2']) expect((await put(b, { q })).status).toBe(400);
    expect((await put(b, { q: 'w=16384&h=1' })).status).toBe(201);
    expect(store.stats().count).toBe(1);
  });

  it('refuses a type the bytes do not back, and a non-image, with 415 and code type', async () => {
    const jpeg = body(JPEG, 40, 2);
    const res = await put(jpeg, { type: 'image/png' });
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe('type');
    const text = Buffer.from('hello');
    expect((await put(text, { type: 'text/plain' })).status).toBe(415);
    expect((await put(text, { type: 'image/png' })).status).toBe(415);
    expect((await put(body(PNG), { type: 'image/svg+xml' })).status).toBe(415);
    expect(store.stats().count).toBe(0);
  });

  it('refuses over 5 MB with 413 and code size, streamed and declared', async () => {
    const big = body(PNG, MAX_IMAGE_BYTES + 1, 3);
    const res = await put(big);
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('size');
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(`${base}/api/images/${sha(PNG)}?w=1&h=1`, { method: 'PUT', headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) } }, (r) => {
        r.resume();
        resolve(r.statusCode!);
        req.destroy();
      });
      req.on('error', reject);
      req.flushHeaders();
    });
    expect(status).toBe(413);
    expect((await put(body(PNG, MAX_IMAGE_BYTES, 4))).status).toBe(201);
  });

  it('refuses a picture that would pass 50 MB in all with 507 and code store', async () => {
    for (let i = 0; i < 10; i++) expect((await put(body(PNG, MAX_IMAGE_BYTES, i + 1))).status).toBe(201);
    const res = await put(body(PNG, 100, 99));
    expect(res.status).toBe(507);
    expect((await res.json()).code).toBe('store');
    expect((await put(body(PNG, MAX_IMAGE_BYTES, 1))).status).toBe(200); // already stored still answers
  });

  it('refuses a foreign origin and a cross-site request with 403, logged, and sends no CORS header', async () => {
    const b = body(PNG, 40, 5);
    const foreign: Record<string, string>[] = [{ origin: 'http://evil.example' }, { 'sec-fetch-site': 'cross-site' }];
    for (const headers of foreign) {
      const res = await put(b, { headers });
      expect(res.status).toBe(403);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
    expect(logs.filter((l) => /^\[images\] 403 PUT \/api\/images\/[0-9a-f]{64}: /.test(l))).toHaveLength(2);
    expect((await sweep([], { origin: 'http://evil.example' })).status).toBe(403);
    const ok = await put(b, { headers: { origin: base } });
    expect(ok.status).toBe(201);
    expect(ok.headers.get('access-control-allow-origin')).toBeNull();
    const get = await fetch(`${base}/api/images/${sha(b)}`, { headers: { origin: 'http://evil.example' } });
    expect(get.headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(`${base}/api/images`, { method: 'OPTIONS' })).headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers 503 naming VOST_DATA_DIR when the folder is not writable', async () => {
    if (process.getuid?.() === 0) return; // root writes anywhere
    await chmod(dir, 0o555);
    const res = await put(body(PNG, 40, 6));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('VOST_DATA_DIR');
    expect(logs.some((l) => l.startsWith('[images] 503 PUT /api/images/'))).toBe(true);
    expect((await (await fetch(`${base}/api/images`)).json()).writable).toBe(false);
  });
});

describe('GET /api/images', () => {
  it('returns the counts', async () => {
    expect(await (await fetch(`${base}/api/images`)).json()).toEqual({ count: 0, bytes: 0, writable: true });
    await put(body(PNG, 100, 1));
    await put(body(PNG, 50, 2));
    expect(await (await fetch(`${base}/api/images`)).json()).toEqual({ count: 2, bytes: 150, writable: true });
  });
});

describe('POST /api/images/sweep', () => {
  const upload = async (salt: number, at: number) => {
    clock = at;
    const b = body(PNG, 40, salt);
    await put(b);
    return sha(b);
  };

  it('stamps what refs name, removes unreferenced pictures past the grace (file and index) and keeps younger ones', async () => {
    const used = await upload(1, 0);
    const old = await upload(2, 0);
    clock = GRACE_MS + 1;
    const young = await upload(3, GRACE_MS - 9);
    clock = GRACE_MS + 1;
    const res = await sweep([used]);
    expect(await res.json()).toEqual({ removed: [old] });
    expect(store.meta(used)!.seenAt).toBe(GRACE_MS + 1);
    expect(store.meta(young)).toBeDefined();
    expect(store.meta(old)).toBeUndefined();
    expect(await readdir(path.join(dir, 'images'))).not.toContain(old);
    expect((await fetch(`${base}/api/images/${old}`)).status).toBe(404);
  });

  it('keeps a picture a stored settings document names, however deep, and stamps it', async () => {
    const inDrawings = await upload(1, 0);
    const inLayout = await upload(2, 0);
    const nobody = await upload(3, 0);
    await settings.put('drawings.v2', { v: 2, sources: { 'BTC:1h': { drawings: [{ type: 'image', key: inDrawings }] } } });
    await settings.put('layouts', [{ name: 'a', panes: [{ nested: { deeper: [inLayout] } }] }]);
    clock = GRACE_MS + 5;
    expect(await (await sweep([])).json()).toEqual({ removed: [nobody] });
    expect(store.meta(inDrawings)!.seenAt).toBe(clock);
    expect(store.meta(inLayout)!.seenAt).toBe(clock);
  });

  it('removes nothing, but still stamps refs, when the settings cannot be read', async () => {
    const used = await upload(1, 0);
    const other = await upload(2, 0);
    settingsList = () => Promise.reject(new Error('disk gone'));
    clock = GRACE_MS + 5;
    expect(await (await sweep([used])).json()).toEqual({ removed: [] });
    expect(store.meta(other)).toBeDefined();
    expect(store.meta(used)!.seenAt).toBe(clock);
    expect(logs.some((l) => l.includes('nothing is removed'))).toBe(true);
  });

  it('checks its body: JSON content type, shape and size', async () => {
    expect((await fetch(`${base}/api/images/sweep`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status).toBe(415);
    expect((await sweep('nope')).status).toBe(400);
    expect((await sweep([1])).status).toBe(400);
    const huge = await fetch(`${base}/api/images/sweep`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refs: ['x'.repeat(1024 * 1024)] }) });
    expect(huge.status).toBe(413);
  });
});
