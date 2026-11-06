import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmod, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDocStore, type DocStoreDeps } from '../settings/store.ts';
import { handleStrategyMaker, isStrategyMakerPath, MAX_BULK_BYTES, MAX_SET_BYTES, sameJson, setName } from './route.ts';

type Reply = Omit<Response, 'json'> & { json(): Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const fetch = (...args: Parameters<typeof globalThis.fetch>): Promise<Reply> => globalThis.fetch(...args) as Promise<Reply>;

let dir = '';
let server: http.Server | undefined;
let base = '';
let logs: string[] = [];

async function boot(extra: Partial<DocStoreDeps> = {}): Promise<void> {
  const store = createDocStore({ dir: path.join(dir, 'strategy-maker'), log: () => undefined, ...extra });
  const deps = { store, archiveDir: dir, log: (l: string) => logs.push(l), now: () => 777 };
  const srv = (server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    if (isStrategyMakerPath(url.pathname)) void handleStrategyMaker(req, res, url, deps);
    else res.end('other');
  }));
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-sm-route-'));
  logs = [];
  server = undefined;
});
afterEach(async () => {
  await new Promise((r) => (server ? server.close(r) : r(undefined)));
  await chmod(dir, 0o755).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

const J = { 'content-type': 'application/json' };
const api = (p: string) => `${base}/api/strategy-maker/${p}`;
const setUrl = (id: string) => api(`sets/${encodeURIComponent(id)}`);
const set = (id: string, extra: Record<string, unknown> = {}) => ({ id, version: 1, trades: [], updatedAt: 1, ...extra });
const send = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method, headers: { ...J, ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
const putSet = (s: { id: string }, headers: Record<string, string> = {}) => send('PUT', setUrl(s.id), s, headers);
const listIds = async (): Promise<string[]> => (await (await fetch(api('sets'))).json()).sets.map((s: { id: string }) => s.id).sort();

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

describe('sameJson', () => {
  it('compares deeply and ignores key order', () => {
    expect(sameJson({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: 1 })).toBe(false);
    expect(sameJson([1, 2], [1])).toBe(false);
    expect(sameJson({ a: undefined }, { b: 1 })).toBe(false);
  });
});

describe('/api/strategy-maker sets', () => {
  it('lists, gets, puts and deletes', async () => {
    await boot();
    expect(await (await fetch(api('sets'))).json()).toEqual({ sets: [] });
    expect((await fetch(setUrl('provider|demo|BTC|1h'))).status).toBe(404);
    expect((await putSet(set('provider|demo|BTC|1h', { trades: [1] }))).status).toBe(204);
    expect(await (await fetch(setUrl('provider|demo|BTC|1h'))).json()).toEqual(set('provider|demo|BTC|1h', { trades: [1] }));
    expect(await listIds()).toEqual(['provider|demo|BTC|1h']);
    expect((await send('DELETE', setUrl('provider|demo|BTC|1h'))).status).toBe(204);
    expect((await send('DELETE', setUrl('provider|demo|BTC|1h'))).status).toBe(404);
    expect(await listIds()).toEqual([]);
  });

  it('round-trips ids with bars, spaces, slashes, non-ASCII and over 200 characters', async () => {
    await boot();
    const ids = ['csv|my file (1).csv', 'csv|a/b/../c', 'csv|é中文 \u{1F600}', `csv|${'x'.repeat(300)}`, 'provider|a|B/C|1h', 'csv|%2F'];
    for (const id of ids) expect((await putSet(set(id))).status).toBe(204);
    expect(await listIds()).toEqual([...ids].sort());
    for (const id of ids) expect((await (await fetch(setUrl(id))).json()).id).toBe(id);
    const files = await readdir(path.join(dir, 'strategy-maker'));
    for (const f of files) expect(f).toMatch(/^set-[0-9a-f]{64}\.json$/);
    expect((await send('DELETE', setUrl(ids[3]!))).status).toBe(204);
    expect((await fetch(setUrl(ids[3]!))).status).toBe(404);
  });

  it('refuses a body whose id differs from the path, and a non-object', async () => {
    await boot();
    expect((await send('PUT', setUrl('a'), set('b'))).status).toBe(400);
    expect((await send('PUT', setUrl('a'), [1])).status).toBe(400);
    expect((await send('PUT', setUrl('a'), 'nope')).status).toBe(400);
    expect((await fetch(`${base}/api/strategy-maker/sets/%E0%A4%A`)).status).toBe(400);
    expect(await listIds()).toEqual([]);
  });

  it('answers 404 for a set whose stored id differs from the asked one', async () => {
    await boot();
    await putSet(set('a'));
    // A file under the name of "b" that holds another id.
    await writeFile(path.join(dir, 'strategy-maker', `${setName('b')}.json`), JSON.stringify(set('c')));
    expect((await fetch(setUrl('b'))).status).toBe(404);
    expect((await send('DELETE', setUrl('b'))).status).toBe(404);
    expect(await listIds()).toEqual(['a']);
  });
});

describe('/api/strategy-maker inputs, model and job', () => {
  it.each(['inputs', 'model', 'job'])('gets, puts and deletes %s', async (kind) => {
    await boot();
    expect((await fetch(api(kind))).status).toBe(404);
    const rec = { id: kind === 'inputs' ? 'find-inputs' : kind, version: 1, x: [1] };
    expect((await send('PUT', api(kind), rec)).status).toBe(204);
    expect(await (await fetch(api(kind))).json()).toEqual(rec);
    expect(await listIds()).toEqual([]);
    expect((await send('DELETE', api(kind))).status).toBe(204);
    expect((await send('DELETE', api(kind))).status).toBe(404);
  });
});

describe('/api/strategy-maker/import', () => {
  it('overwrites the sets it names and the model, and keeps the others', async () => {
    await boot();
    await putSet(set('keep'));
    await putSet(set('over', { updatedAt: 1 }));
    await send('PUT', api('model'), { id: 'model', old: true });
    await send('PUT', api('inputs'), { id: 'find-inputs' });
    const res = await send('POST', api('import'), { sets: [set('over', { updatedAt: 9 }), set('new')], model: { id: 'model', fresh: true } });
    expect(res.status).toBe(204);
    expect(await listIds()).toEqual(['keep', 'new', 'over']);
    expect((await (await fetch(setUrl('over'))).json()).updatedAt).toBe(9);
    expect(await (await fetch(api('model'))).json()).toEqual({ id: 'model', fresh: true });
    expect((await fetch(api('inputs'))).status).toBe(200);
    await send('POST', api('import'), { sets: [], model: null });
    expect(await (await fetch(api('model'))).json()).toEqual({ id: 'model', fresh: true });
  });

  it('answers 503 and changes nothing when a temp write fails, leaving no temp file', async () => {
    let fail = false;
    let n = 0;
    await boot({
      writeFile: async (file, text) => {
        n += 1;
        if (fail && n >= 3) throw new Error('disk full');
        await writeFile(file, text);
      },
    });
    await putSet(set('a', { updatedAt: 1 }));
    await send('PUT', api('model'), { id: 'model', old: true });
    fail = true;
    n = 0;
    const res = await send('POST', api('import'), { sets: [set('a', { updatedAt: 9 }), set('b'), set('c')], model: { id: 'model', fresh: true } });
    expect(res.status).toBe(503);
    expect(await listIds()).toEqual(['a']);
    expect((await (await fetch(setUrl('a'))).json()).updatedAt).toBe(1);
    expect(await (await fetch(api('model'))).json()).toEqual({ id: 'model', old: true });
    expect(await readdir(path.join(dir, 'strategy-maker'))).toHaveLength(2);
  });

  it('refuses a malformed body', async () => {
    await boot();
    expect((await send('POST', api('import'), { sets: [{ nope: 1 }], model: null })).status).toBe(400);
    expect((await send('POST', api('import'), { sets: [] })).status).toBe(400);
    expect((await send('POST', api('import'), 'x')).status).toBe(400);
  });
});

describe('/api/strategy-maker/migrate', () => {
  it('adopts what is missing, counts equal records as present, and archives differing ones', async () => {
    await boot();
    await putSet(set('same', { trades: [1] }));
    await putSet(set('differs', { trades: [1] }));
    await send('PUT', api('model'), { id: 'model', v: 1 });
    const res = await send('POST', api('migrate'), {
      sets: [{ trades: [1], id: 'same', updatedAt: 1, version: 1 }, set('differs', { trades: [2] }), set('fresh')],
      inputs: { id: 'find-inputs', form: {} },
      model: { id: 'model', v: 2 },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      adopted: ['fresh', 'inputs'],
      present: ['same'],
      archived: ['differs', 'model'],
      file: 'strategy-maker-imported-777.json',
    });
    expect((await (await fetch(setUrl('differs'))).json()).trades).toEqual([1]);
    expect(await (await fetch(api('model'))).json()).toEqual({ id: 'model', v: 1 });
    expect(JSON.parse(await readFile(path.join(dir, 'strategy-maker-imported-777.json'), 'utf8'))).toEqual({
      sets: [set('differs', { trades: [2] })],
      inputs: null,
      model: { id: 'model', v: 2 },
    });
    expect(logs).toContain('[strategy-maker] migrate: adopted 2, present 1, archived 2 (strategy-maker-imported-777.json)');
  });

  it('is idempotent and never overwrites an earlier archive', async () => {
    await boot();
    const body = { sets: [set('a')], inputs: null, model: null };
    expect(await (await send('POST', api('migrate'), body)).json()).toEqual({ adopted: ['a'], present: [], archived: [], file: null });
    expect(await (await send('POST', api('migrate'), body)).json()).toEqual({ adopted: [], present: ['a'], archived: [], file: null });
    const other = { sets: [set('a', { trades: [3] })], inputs: null, model: null };
    expect((await (await send('POST', api('migrate'), other)).json()).file).toBe('strategy-maker-imported-777.json');
    expect((await (await send('POST', api('migrate'), other)).json()).file).toBe('strategy-maker-imported-778.json');
    expect(await readdir(dir)).toEqual(['strategy-maker', 'strategy-maker-imported-777.json', 'strategy-maker-imported-778.json']);
  });

  it('refuses a malformed body', async () => {
    await boot();
    expect((await send('POST', api('migrate'), { sets: [] })).status).toBe(400);
    expect((await send('POST', api('migrate'), { sets: [1], inputs: null, model: null })).status).toBe(400);
  });
});

describe('/api/strategy-maker guards', () => {
  it('refuses cross-site writes with a log line', async () => {
    await boot();
    expect((await putSet(set('a'), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await putSet(set('a'), { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await send('POST', api('import'), { sets: [], model: null }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await send('POST', api('migrate'), { sets: [], inputs: null, model: null }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await send('DELETE', api('model'), undefined, { origin: 'https://evil.example' })).status).toBe(403);
    expect(logs[0]).toMatch(/^\[strategy-maker\] 403 PUT \/api\/strategy-maker\/sets\/a: /);
    expect((await putSet(set('a'), { origin: base })).status).toBe(204);
  });

  it('answers 415, 405, 404 and 413', async () => {
    await boot();
    expect((await putSet(set('a'), { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await send('POST', api('sets/a'), set('a'))).status).toBe(405);
    expect((await send('PUT', api('sets'), '{}')).status).toBe(405);
    expect((await send('GET', api('import'))).status).toBe(405);
    expect((await send('GET', api('migrate'))).status).toBe(405);
    expect((await send('PUT', api('elsewhere'), '{}')).status).toBe(404);
    expect(await declared('PUT', '/api/strategy-maker/sets/a', MAX_SET_BYTES + 1)).toBe(413);
    expect(await declared('PUT', '/api/strategy-maker/model', MAX_SET_BYTES + 1)).toBe(413);
    expect(await declared('POST', '/api/strategy-maker/import', MAX_BULK_BYTES + 1)).toBe(413);
    expect(await declared('POST', '/api/strategy-maker/migrate', MAX_BULK_BYTES + 1)).toBe(413);
  });

  it('sends no CORS header on any reply, OPTIONS included', async () => {
    await boot();
    await putSet(set('a'));
    const replies = [
      await fetch(api('sets')),
      await fetch(setUrl('a')),
      await fetch(setUrl('zzz')),
      await fetch(api('model')),
      await fetch(setUrl('a'), { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }),
      await putSet(set('a')),
      await putSet(set('a'), { origin: 'https://evil.example' }),
      await send('POST', api('migrate'), { sets: [], inputs: null, model: null }),
    ];
    expect(replies[4]!.status).toBe(204);
    for (const r of replies) expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it.skipIf(process.getuid?.() === 0)('answers 503 naming VOST_DATA_DIR on a read-only folder, and still serves reads', async () => {
    await boot();
    await putSet(set('a'));
    await chmod(path.join(dir, 'strategy-maker'), 0o555);
    const res = await putSet(set('b'));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain('VOST_DATA_DIR');
    expect((await send('POST', api('import'), { sets: [set('c')], model: null })).status).toBe(503);
    expect((await send('POST', api('migrate'), { sets: [set('c')], inputs: null, model: null })).status).toBe(503);
    expect(logs.some((l) => l.startsWith('[strategy-maker] 503 PUT /api/strategy-maker/sets/b'))).toBe(true);
    expect(await listIds()).toEqual(['a']);
    await chmod(path.join(dir, 'strategy-maker'), 0o755);
  });
});
