import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLibraries } from './libraries.ts';
import { handlePineLibraries, isPineLibrariesPath, MAX_BODY_BYTES } from './route.ts';

const LIB = '//@version=6\nlibrary("MyLib")\nexport f(x) => x + 1\n';
type Reply = Omit<Response, 'json'> & { json(): Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const fetch = (...args: Parameters<typeof globalThis.fetch>): Promise<Reply> => globalThis.fetch(...args) as Promise<Reply>;

let dir = '';
let server: http.Server;
let base = '';
let upstreamCalls: string[] = [];

async function boot(): Promise<void> {
  const libs = createLibraries({
    dir,
    log: () => undefined,
    fetch: (async (input: string | URL) => {
      const url = new URL(String(input));
      upstreamCalls.push(url.href);
      if (url.pathname === '/pubscripts-suggest-json/') {
        return Response.json({ results: [{ scriptName: 'MyLib', author: { username: 'alice' }, version: '1', scriptIdPart: 'PUB;a', extra: { kind: 'library' } }], next: null });
      }
      return Response.json({ source: LIB, scriptAccess: 'open_no_auth' });
    }) as typeof globalThis.fetch,
  });
  await libs.load();
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    if (isPineLibrariesPath(url.pathname)) void handlePineLibraries(req, res, url, libs, () => undefined);
    else res.end('other');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-pine-route-'));
  upstreamCalls = [];
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  await chmod(dir, 0o755).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

const put = (p: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/pine/libraries/${p}`, { method: 'PUT', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('/api/pine/libraries', () => {
  it('fetches, stores and lists a library, with the read CORS grant', async () => {
    await boot();
    const res = await fetch(`${base}/api/pine/libraries/alice/MyLib/1`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.json()).toMatchObject({ path: 'alice/MyLib/1', source: LIB, origin: 'tradingview', scriptId: 'PUB;a' });
    const list = await (await fetch(`${base}/api/pine/libraries`)).json();
    expect(list.libraries).toHaveLength(1);
    expect(list.libraries[0]).not.toHaveProperty('source');
    expect(list.libraries[0].bytes).toBe(Buffer.byteLength(LIB));
  });

  it('answers 404 with a reason, 502 on a TradingView failure and 400 for a bad path', async () => {
    await boot();
    const miss = await fetch(`${base}/api/pine/libraries/alice/Other/1`);
    expect(miss.status).toBe(404);
    expect(await miss.json()).toMatchObject({ reason: 'not-found' });
    for (const bad of ['alice/MyLib', 'alice/My-Lib/1', 'alice/MyLib/0', 'alice/MyLib/x']) {
      expect((await fetch(`${base}/api/pine/libraries/${bad}`)).status, bad).toBe(400);
    }
  });

  it('answers 502 when TradingView fails', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'vost-pine-route-'));
    const libs = createLibraries({ dir, log: () => undefined, fetch: (async () => new Response('no', { status: 400 })) as typeof globalThis.fetch });
    await libs.load();
    server = http.createServer((req, res) => void handlePineLibraries(req, res, new URL(req.url!, 'http://x'), libs, () => undefined));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/api/pine/libraries/alice/MyLib/1`);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain('alice/MyLib/1');
  });

  it('accepts a same-origin paste (no CORS header) and then serves it without TradingView', async () => {
    await boot();
    const res = await put('alice/Closed/2', { source: LIB });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(await res.json()).toMatchObject({ path: 'alice/Closed/2', origin: 'pasted' });
    const got = await fetch(`${base}/api/pine/libraries/alice/Closed/2`);
    expect((await got.json()).origin).toBe('pasted');
    expect(upstreamCalls).toHaveLength(0);
    const del = await fetch(`${base}/api/pine/libraries/alice/Closed/2`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect(del.headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(`${base}/api/pine/libraries/alice/Closed/2`, { method: 'DELETE' })).status).toBe(404);
  });

  it('refuses cross-site writes', async () => {
    await boot();
    expect((await put('alice/MyLib/1', { source: LIB }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await put('alice/MyLib/1', { source: LIB }, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    const del = await fetch(`${base}/api/pine/libraries/alice/MyLib/1`, { method: 'DELETE', headers: { origin: 'https://evil.example' } });
    expect(del.status).toBe(403);
    expect((await put('alice/MyLib/1', { source: LIB }, { origin: base })).status).toBe(200);
  });

  it('rejects a big body (413), a non-library (400), bad JSON (400) and a wrong content type (415)', async () => {
    await boot();
    expect((await put('alice/MyLib/1', { source: 'x'.repeat(MAX_BODY_BYTES + 10) })).status).toBe(413);
    expect((await put('alice/MyLib/1', { source: '//@version=6\nindicator("x")' })).status).toBe(400);
    expect((await put('alice/MyLib/1', 'nope')).status).toBe(400);
    expect((await put('alice/MyLib/1', { nosource: 1 })).status).toBe(400);
    expect((await put('alice/MyLib/1', { source: LIB }, { 'content-type': 'text/plain' })).status).toBe(415);
  });

  it.skipIf(process.getuid?.() === 0)('answers 503 naming VOST_DATA_DIR on a read-only folder, and still serves reads', async () => {
    await chmod(dir, 0o555);
    await boot();
    const res = await put('alice/MyLib/1', { source: LIB });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('VOST_DATA_DIR');
    expect((await fetch(`${base}/api/pine/libraries/alice/MyLib/1`)).status).toBe(200);
  });
});
