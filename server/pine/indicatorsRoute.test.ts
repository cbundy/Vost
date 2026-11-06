import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createIndicators } from './indicators.ts';
import { handlePineIndicators, isPineIndicatorsPath } from './indicatorsRoute.ts';

const SRC = '// MPL\n//@version=5\nindicator("Supertrend")\nplot(close)\n';
type Reply = Omit<Response, 'json'> & { json(): Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const fetch = (...args: Parameters<typeof globalThis.fetch>): Promise<Reply> => globalThis.fetch(...args) as Promise<Reply>;

let dir = '';
let server: http.Server;
let base = '';
let down = false;
let logs: string[] = [];

async function boot(): Promise<void> {
  const store = createIndicators({
    dir,
    log: () => undefined,
    fetch: (async (input: string | URL) => {
      if (down) return new Response('boom', { status: 400 });
      const url = new URL(String(input));
      if (url.pathname === '/pubscripts-suggest-json/') {
        return Response.json({ results: [{ scriptName: 'Supertrend', author: { username: 'alice' }, scriptIdPart: 'PUB;a', imageUrl: 'abc', access: 1, extra: { kind: 'study', stats: { plot: 1 } } }], next: null });
      }
      if (url.pathname.startsWith('/script/')) return new Response('{"script":{"script_id_part":"PUB;a"}}');
      if (url.pathname.includes('PUB%3Bclosed')) return Response.json({ scriptAccess: 'closed_no_auth' });
      return Response.json({ source: SRC, scriptAccess: 'open_no_auth', scriptName: 'Supertrend', version: '1.0' });
    }) as typeof globalThis.fetch,
  });
  await store.load();
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    if (isPineIndicatorsPath(url.pathname)) void handlePineIndicators(req, res, url, store, (l) => logs.push(l));
    else res.end('other');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-pine-ind-route-'));
  down = false;
  logs = [];
});
afterEach(async () => {
  await new Promise((r) => server.close(r));
  await chmod(dir, 0o755).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/pine/indicators`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('/api/pine/indicators', () => {
  it('searches, adds, lists, reads and removes, with the read CORS grant and none on writes', async () => {
    await boot();
    const found = await fetch(`${base}/api/pine/indicators/search?q=super`);
    expect(found.status).toBe(200);
    expect(found.headers.get('access-control-allow-origin')).toBe('*');
    expect((await found.json()).results[0]).toMatchObject({ scriptId: 'PUB;a', stored: false });

    const added = await post({ scriptId: 'PUB;a' });
    expect(added.status).toBe(200);
    expect(added.headers.get('access-control-allow-origin')).toBeNull();
    expect(await added.json()).toMatchObject({ scriptId: 'PUB;a', name: 'Supertrend', author: 'alice' });

    const list = await (await fetch(`${base}/api/pine/indicators`)).json();
    expect(list.indicators).toHaveLength(1);
    expect(list.indicators[0].source).toBeUndefined();

    const one = await fetch(`${base}/api/pine/indicators/${encodeURIComponent('PUB;a')}`);
    expect((await one.json()).source).toBe(SRC);

    const del = await fetch(`${base}/api/pine/indicators/${encodeURIComponent('PUB;a')}`, { method: 'DELETE' });
    expect(del.status).toBe(204);
    expect(del.headers.get('access-control-allow-origin')).toBeNull();
    expect((await fetch(`${base}/api/pine/indicators/${encodeURIComponent('PUB;a')}`)).status).toBe(404);
    expect((await fetch(`${base}/api/pine/indicators/${encodeURIComponent('PUB;a')}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('adds by link', async () => {
    await boot();
    const res = await post({ link: 'https://www.tradingview.com/script/abc/' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ scriptId: 'PUB;a' });
  });

  it('answers 405 with the allowed methods', async () => {
    await boot();
    const a = await fetch(`${base}/api/pine/indicators`, { method: 'PUT' });
    expect(a.status).toBe(405);
    expect(a.headers.get('allow')).toBe('GET, POST');
    const b = await fetch(`${base}/api/pine/indicators/search?q=x`, { method: 'POST' });
    expect(b.status).toBe(405);
    const c = await fetch(`${base}/api/pine/indicators/${encodeURIComponent('PUB;a')}`, { method: 'POST' });
    expect(c.status).toBe(405);
  });

  it('refuses cross-site writes with 403 and no CORS header', async () => {
    await boot();
    const p = await post({ scriptId: 'PUB;a' }, { origin: 'https://evil.example' });
    expect(p.status).toBe(403);
    expect(p.headers.get('access-control-allow-origin')).toBeNull();
    const d = await fetch(`${base}/api/pine/indicators/${encodeURIComponent('PUB;a')}`, { method: 'DELETE', headers: { 'sec-fetch-site': 'cross-site' } });
    expect(d.status).toBe(403);
    expect(d.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers 400 for an empty query, a foreign link, a bad body and a bad id', async () => {
    await boot();
    expect((await fetch(`${base}/api/pine/indicators/search?q=`)).status).toBe(400);
    expect((await fetch(`${base}/api/pine/indicators/search`)).status).toBe(400);
    expect((await post({ link: 'https://evil.example/script/abc/' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post('{nope')).status).toBe(400);
    expect((await fetch(`${base}/api/pine/indicators/nonsense`)).status).toBe(400);
  });

  it('answers 404 for an unknown id and 404 closed-source for a closed script', async () => {
    await boot();
    expect((await fetch(`${base}/api/pine/indicators/${encodeURIComponent('PUB;nope')}`)).status).toBe(404);
    const closed = await post({ scriptId: 'PUB;closed' });
    expect(closed.status).toBe(404);
    expect(await closed.json()).toMatchObject({ reason: 'closed-source' });
  });

  it('answers 502 when TradingView fails, and logs it', async () => {
    await boot();
    down = true;
    expect((await post({ scriptId: 'PUB;a' })).status).toBe(502);
    expect((await fetch(`${base}/api/pine/indicators/search?q=x`)).status).toBe(502);
    expect(logs.some((l) => l.startsWith('[pine-indicators] 502'))).toBe(true);
  });

  it('answers 415 for a POST that is not JSON', async () => {
    await boot();
    const res = await fetch(`${base}/api/pine/indicators`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
    expect(res.status).toBe(415);
  });

  it.skipIf(process.getuid?.() === 0)('answers 503 naming VOST_DATA_DIR when the folder is not writable', async () => {
    await chmod(dir, 0o555);
    await boot();
    const res = await post({ scriptId: 'PUB;a' });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('VOST_DATA_DIR');
    const del = await fetch(`${base}/api/pine/indicators/${encodeURIComponent('PUB;a')}`, { method: 'DELETE' });
    expect(del.status).toBe(503);
  });
});
