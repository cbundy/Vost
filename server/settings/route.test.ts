import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmod, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleSettings, isSettingsPath, MAX_DOC_BYTES, MAX_IMPORT_BYTES } from './route.ts';
import { createDocStore } from './store.ts';

type Reply = Omit<Response, 'json'> & { json(): Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const fetch = (...args: Parameters<typeof globalThis.fetch>): Promise<Reply> => globalThis.fetch(...args) as Promise<Reply>;

let dir = '';
let server: http.Server;
let base = '';
let logs: string[] = [];

async function boot(): Promise<void> {
  const store = createDocStore({ dir: path.join(dir, 'settings'), log: () => undefined });
  const deps = { store, archiveDir: dir, log: (l: string) => logs.push(l), now: () => 777 };
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    if (isSettingsPath(url.pathname)) void handleSettings(req, res, url, deps);
    else res.end('other');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-settings-route-'));
  logs = [];
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  await chmod(dir, 0o755).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

const J = { 'content-type': 'application/json' };
const put = (n: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/settings/${n}`, { method: 'PUT', headers: { ...J, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/settings/import`, { method: 'POST', headers: { ...J, ...headers }, body: JSON.stringify(body) });

/** A request that declares a huge body and sends none. */
function declared(method: string, p: string, length: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(`${base}${p}`, { method, headers: { ...J, 'content-length': String(length) } }, (res) => {
      res.resume();
      resolve(res.statusCode!);
      req.destroy();
    });
    req.on('error', reject);
    req.flushHeaders();
  });
}

describe('/api/settings', () => {
  it('lists, gets, puts and deletes', async () => {
    await boot();
    expect(await (await fetch(`${base}/api/settings`)).json()).toEqual({ values: {} });
    expect((await fetch(`${base}/api/settings/theme`)).status).toBe(404);
    expect((await put('theme', { dark: true })).status).toBe(204);
    expect(await (await fetch(`${base}/api/settings/theme`)).json()).toEqual({ dark: true });
    expect(await (await fetch(`${base}/api/settings`)).json()).toEqual({ values: { theme: { dark: true } } });
    expect((await fetch(`${base}/api/settings/theme`, { method: 'DELETE', headers: J })).status).toBe(204);
    expect((await fetch(`${base}/api/settings/theme`, { method: 'DELETE', headers: J })).status).toBe(404);
  });

  it('imports absent names and archives the ones it has, never overwriting', async () => {
    await boot();
    await put('keep', '"mine"');
    const res = await post({ values: { keep: 'theirs', fresh: 1, 'bad/name': 2 } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ adopted: ['fresh'], archived: ['keep', 'bad/name'], file: 'settings-imported-777.json' });
    expect(await (await fetch(`${base}/api/settings/keep`)).json()).toBe('mine');
    expect(await (await fetch(`${base}/api/settings/fresh`)).json()).toBe(1);
    expect(JSON.parse(await readFile(path.join(dir, 'settings-imported-777.json'), 'utf8'))).toEqual({ values: { keep: 'theirs', 'bad/name': 2 } });
    const again = await (await post({ values: { fresh: 5 } })).json();
    expect(again).toEqual({ adopted: [], archived: ['fresh'], file: 'settings-imported-777.json'.replace('777', '778') });
    const none = await (await post({ values: { other: 1 } })).json();
    expect(none).toEqual({ adopted: ['other'], archived: [], file: null });
    expect((await post({ nope: 1 })).status).toBe(400);
  });

  it('refuses cross-site writes with a log line', async () => {
    await boot();
    expect((await put('a', 1, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await put('a', 1, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await post({ values: {} }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await fetch(`${base}/api/settings/a`, { method: 'DELETE', headers: { origin: 'https://evil.example' } })).status).toBe(403);
    expect(logs[0]).toMatch(/^\[settings\] 403 PUT \/api\/settings\/a: /);
    expect((await put('a', 1, { origin: base })).status).toBe(204);
  });

  it('answers 415, 400, 405 and 413', async () => {
    await boot();
    expect((await put('a', 1, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await put('a', 'nope')).status).toBe(400);
    expect((await put('..%2Fx', 1)).status).toBe(400);
    expect((await put('.x', 1)).status).toBe(400);
    expect((await fetch(`${base}/api/settings/%E0%A4%A`)).status).toBe(400);
    expect((await fetch(`${base}/api/settings/a`, { method: 'POST', headers: J, body: '1' })).status).toBe(405);
    expect((await fetch(`${base}/api/settings`, { method: 'PUT', headers: J, body: '1' })).status).toBe(405);
    expect((await fetch(`${base}/api/settings/import`, { method: 'GET' })).status).toBe(405);
    expect(await declared('PUT', '/api/settings/a', MAX_DOC_BYTES + 1)).toBe(413);
    expect(await declared('POST', '/api/settings/import', MAX_IMPORT_BYTES + 1)).toBe(413);
  });

  it('sends no CORS header on any reply, OPTIONS included', async () => {
    await boot();
    await put('a', 1);
    const replies = [
      await fetch(`${base}/api/settings`),
      await fetch(`${base}/api/settings/a`),
      await fetch(`${base}/api/settings/zzz`),
      await fetch(`${base}/api/settings/a`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }),
      await put('a', 2),
      await put('a', 2, { origin: 'https://evil.example' }),
    ];
    expect(replies[3]!.status).toBe(204);
    for (const r of replies) expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it.skipIf(process.getuid?.() === 0)('answers 503 naming VOST_DATA_DIR on a read-only folder, and still serves reads', async () => {
    await boot();
    await put('a', 1);
    await chmod(path.join(dir, 'settings'), 0o555);
    const res = await put('b', 1);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('VOST_DATA_DIR');
    expect((await post({ values: { c: 1 } })).status).toBe(503);
    expect(logs.some((l) => l.startsWith('[settings] 503 PUT /api/settings/b'))).toBe(true);
    expect(await (await fetch(`${base}/api/settings/a`)).json()).toBe(1);
    expect(await readdir(path.join(dir, 'settings'))).toEqual(['a.json']);
    await chmod(path.join(dir, 'settings'), 0o755);
  });
});
