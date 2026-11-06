import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { chmod, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDocStore } from '../settings/store.ts';
import { createJobs, type Jobs } from './jobs.ts';
import { UNAVAILABLE } from './pool.ts';
import { handleJobs, isJobsPath, MAX_BODY_BYTES } from './route.ts';

type Reply = Omit<Response, 'json'> & { json(): Promise<any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
const fetch = (...args: Parameters<typeof globalThis.fetch>): Promise<Reply> => globalThis.fetch(...args) as Promise<Reply>;

interface Call {
  request: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  onMessage?: (m: unknown) => void;
  resolve: (m: unknown) => void;
  cancelled: boolean;
}

let dir = '';
let server: http.Server;
let base = '';
let logs: string[] = [];
let calls: Call[] = [];
let jobs: Jobs;
let bundle = true;
let seq = 0;

async function boot(): Promise<void> {
  const store = createDocStore({ dir: path.join(dir, 'jobs'), log: () => undefined });
  const pool = {
    size: 1,
    close: () => undefined,
    run(request: unknown, _f: unknown, onMessage?: (m: unknown) => void) {
      const call = { request, onMessage, cancelled: false } as Call;
      let reject!: (e: Error) => void;
      const done = new Promise<unknown>((resolve, rej) => {
        call.resolve = resolve;
        reject = rej;
      });
      calls.push(call);
      return { done, cancel: () => ((call.cancelled = true), reject(new Error('Cancelled'))) };
    },
  };
  jobs = createJobs({ store, pool, bundleExists: () => bundle, newId: () => `j${++seq}`, log: (l) => logs.push(l) });
  await jobs.start();
  const deps = { jobs, store, log: (l: string) => logs.push(l), heartbeatMs: 30 };
  server = http.createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    if (isJobsPath(url.pathname)) void handleJobs(req, res, url, deps);
    else res.end('other');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-jobs-route-'));
  logs = [];
  calls = [];
  bundle = true;
  seq = 0;
  await boot();
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await chmod(dir, 0o755).catch(() => undefined);
  await chmod(path.join(dir, 'jobs'), 0o755).catch(() => undefined);
  await rm(dir, { recursive: true, force: true });
});

const J = { 'content-type': 'application/json' };
const body = (extra: Record<string, unknown> = {}) => ({ kind: 'run', scope: 'chart:1', request: { candles: [], config: { strategyId: 'sma_cross' } }, ...extra });
const post = (b: unknown, headers: Record<string, string> = {}) => fetch(`${base}/api/jobs`, { method: 'POST', headers: { ...J, ...headers }, body: typeof b === 'string' ? b : JSON.stringify(b) });
const flush = () => new Promise((r) => setTimeout(r, 30));

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

describe('/api/jobs', () => {
  it('creates a job (201), lists it and reads it with its result', async () => {
    const r = await post(body());
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ id: 'j1', state: 'queued', kind: 'run' });
    await post(body({ scope: 'other' }));
    expect((await (await fetch(`${base}/api/jobs`)).json()).jobs.map((j: { id: string }) => j.id)).toEqual(['j2', 'j1']);
    const scoped = await (await fetch(`${base}/api/jobs?scope=other`)).json();
    expect(scoped.jobs).toHaveLength(1);
    expect(scoped.jobs[0].id).toBe('j2');
    const running = await (await fetch(`${base}/api/jobs/j1`)).json();
    expect(running.state).toBe('running');
    expect(running.result).toBeUndefined();
    calls[0].resolve({ proto: 'backtest', msg: { type: 'result', metrics: { n: 1 } } });
    await flush();
    const done = await (await fetch(`${base}/api/jobs/j1`)).json();
    expect(done).toMatchObject({ state: 'done', result: { type: 'result', metrics: { n: 1 } } });
    expect((await fetch(`${base}/api/jobs/zzz`)).status).toBe(404);
  });

  it('streams job events for state changes and progress', async () => {
    const ac = new AbortController();
    const res = await fetch(`${base}/api/jobs/events?scope=chart:1`, { signal: ac.signal });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = '';
    const until = async (needle: string): Promise<void> => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) throw new Error(`stream ended before ${needle}`);
        text += dec.decode(value);
      }
    };
    await post(body({ scope: 'ignored' }));
    await post(body());
    await until('"state":"queued"');
    await until(': ping');
    calls[0].resolve({ proto: 'backtest', msg: { type: 'result' } });
    await flush();
    calls[1].onMessage!({ proto: 'backtest', msg: { type: 'progress', pct: 0.5 } });
    calls[1].resolve({ proto: 'backtest', msg: { type: 'result' } });
    await until('"state":"done"');
    expect(text).toContain('event: job');
    expect(text).not.toContain('ignored');
    ac.abort();
  });

  it('cancels (200) and removes (204) with DELETE', async () => {
    await post(body());
    const c = await fetch(`${base}/api/jobs/j1`, { method: 'DELETE' });
    expect(c.status).toBe(200);
    expect(await c.json()).toMatchObject({ state: 'cancelled' });
    expect(calls[0].cancelled).toBe(true);
    expect((await fetch(`${base}/api/jobs/j1`, { method: 'DELETE' })).status).toBe(204);
    expect((await fetch(`${base}/api/jobs/j1`, { method: 'DELETE' })).status).toBe(404);
  });

  it('refuses bad requests with 400', async () => {
    for (const b of [body({ kind: 'nope' }), body({ scope: '' }), body({ request: 3 }), body({ placement: { where: 'x', reason: 'auto' } }), '{oops', '[]']) {
      expect((await post(b)).status).toBe(400);
    }
    const ok = await post(body({ placement: { where: 'server', reason: 'fallback' } }));
    expect((await ok.json()).placement).toEqual({ where: 'server', reason: 'fallback' });
  });

  it('refuses pine and custom with 422', async () => {
    for (const strategyId of ['pine', 'custom']) {
      const r = await post(body({ request: { config: { strategyId } } }));
      expect(r.status).toBe(422);
      expect((await r.json()).error).toContain('runs in the browser');
    }
  });

  it('refuses a foreign origin and cross-site fetches with 403 and a log line', async () => {
    expect((await post(body(), { origin: 'http://evil.example' })).status).toBe(403);
    expect((await post(body(), { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await fetch(`${base}/api/jobs/j1`, { method: 'DELETE', headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect(logs.some((l) => l.startsWith('[jobs] 403 POST /api/jobs'))).toBe(true);
  });

  it('answers 415, 405, 413 and OPTIONS, with no CORS header anywhere', async () => {
    const replies: Reply[] = [];
    replies.push(await fetch(`${base}/api/jobs`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' }));
    expect(replies[0].status).toBe(415);
    replies.push(await fetch(`${base}/api/jobs`, { method: 'PUT', headers: J, body: '{}' }));
    expect(replies[1].status).toBe(405);
    expect(replies[1].headers.get('allow')).toBe('GET, POST');
    replies.push(await fetch(`${base}/api/jobs/j1`, { method: 'POST', headers: J, body: '{}' }));
    expect(replies[2].status).toBe(405);
    expect(replies[2].headers.get('allow')).toBe('GET, DELETE');
    expect(await declared('POST', '/api/jobs', MAX_BODY_BYTES + 1)).toBe(413);
    replies.push(await fetch(`${base}/api/jobs`, { method: 'OPTIONS', headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' } }));
    expect(replies[3].status).toBe(204);
    replies.push(await post(body()), await fetch(`${base}/api/jobs`), await fetch(`${base}/api/jobs/nope`));
    for (const r of replies) expect(r.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('answers 503 without the engine bundle and for a data folder that cannot be written', async () => {
    bundle = false;
    const r = await post(body());
    expect(r.status).toBe(503);
    expect((await r.json()).error).toBe(UNAVAILABLE);
    bundle = true;
    await mkdir(path.join(dir, 'jobs'), { recursive: true });
    await chmod(path.join(dir, 'jobs'), 0o555);
    const w = await post(body());
    if (process.getuid?.() !== 0) {
      expect(w.status).toBe(503);
      expect((await w.json()).error).toContain('VOST_DATA_DIR');
    }
  });
});
