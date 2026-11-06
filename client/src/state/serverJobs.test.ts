import { describe, expect, it, vi } from 'vitest';
import { createServerJobs, ServerUnavailableError, type ServerJobSummary } from './serverJobs';

class FakeES {
  static instances: FakeES[] = [];
  listeners = new Map<string, Array<(ev: unknown) => void>>();
  closed = false;
  constructor(public url: string) {
    FakeES.instances.push(this);
  }
  addEventListener(name: string, fn: (ev: unknown) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  fire(name: string, data?: unknown) {
    for (const fn of this.listeners.get(name) ?? []) fn({ data: JSON.stringify(data) });
  }
}

const summary = (over: Partial<ServerJobSummary> = {}): ServerJobSummary => ({ id: 'j1', kind: 'optimize', scope: 'chart-1', state: 'running', progress: 0, created: 1, ...over });
const json = (status: number, body?: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body }) as Response;

function setup(handler: (url: string, init?: RequestInit) => Response | Promise<Response> = () => json(404, { error: 'none' })) {
  FakeES.instances = [];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init);
  });
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const api = createServerJobs({
    fetch: fetchFn as unknown as typeof fetch,
    EventSource: FakeES as unknown as typeof EventSource,
    setTimeout: ((fn: () => void, ms: number) => {
      timers.push({ fn, ms, live: true });
      return timers.length - 1;
    }) as never,
    clearTimeout: ((t: number) => void (timers[t].live = false)) as never,
  });
  const tick = async () => {
    const t = timers.find((x) => x.live);
    if (!t) throw new Error('no timer');
    t.live = false;
    t.fn();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { api, calls, fetchFn, tick, timers };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('startJob', () => {
  it('posts kind, request, scope and placement as JSON', async () => {
    const { api, calls } = setup(() => json(201, summary()));
    const s = await api.startJob('optimize', { type: 'optimize' }, 'chart-1', { where: 'server', reason: 'setting' });
    expect(s.id).toBe('j1');
    expect(calls[0].url).toBe('/api/jobs');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ kind: 'optimize', request: { type: 'optimize' }, scope: 'chart-1', placement: { where: 'server', reason: 'setting' } });
  });

  it('503 and 413 and a network error are "unavailable"; another refusal is a plain error', async () => {
    for (const status of [503, 413]) {
      const { api } = setup(() => json(status, { error: 'engine missing' }));
      const err = await api.startJob('run', {}, 's', { where: 'server', reason: 'setting' }).catch((e) => e);
      expect(err).toBeInstanceOf(ServerUnavailableError);
      expect(err.reason).toBe('engine missing');
    }
    const down = setup(() => Promise.reject(new Error('offline')));
    expect(await down.api.startJob('run', {}, 's', { where: 'server', reason: 'setting' }).catch((e) => e)).toBeInstanceOf(ServerUnavailableError);
    const refused = setup(() => json(422, { error: 'pine runs in the browser' }));
    const err = await refused.api.startJob('run', {}, 's', { where: 'server', reason: 'setting' }).catch((e) => e);
    expect(err).not.toBeInstanceOf(ServerUnavailableError);
    expect(err.message).toBe('pine runs in the browser');
  });
});

describe('followJob', () => {
  it('delivers stream events to the followers of that job over one EventSource, and closes it after the last', async () => {
    const { api } = setup(() => json(200, summary()));
    const a = vi.fn();
    const b = vi.fn();
    const stopA = api.followJob('j1', a);
    api.followJob('j2', b);
    expect(FakeES.instances).toHaveLength(1);
    expect(FakeES.instances[0].url).toBe('/api/jobs/events');
    await flush();
    a.mockClear();
    FakeES.instances[0].fire('job', summary({ progress: 0.5 }));
    expect(a).toHaveBeenCalledWith(expect.objectContaining({ progress: 0.5 }));
    expect(b).not.toHaveBeenCalled();
    stopA();
    FakeES.instances[0].fire('job', summary({ progress: 0.7 }));
    expect(a).toHaveBeenCalledTimes(1);
    expect(FakeES.instances[0].closed).toBe(false);
    FakeES.instances[0].fire('job', summary({ id: 'j2', state: 'done', progress: 1 }));
    expect(FakeES.instances[0].closed).toBe(true);
  });

  it('stops following once the job ends', async () => {
    const { api } = setup(() => json(200, summary()));
    const a = vi.fn();
    api.followJob('j1', a);
    await flush();
    FakeES.instances[0].fire('job', summary({ state: 'done', progress: 1 }));
    FakeES.instances[0].fire('job', summary({ state: 'done', progress: 1 }));
    expect(a.mock.calls.filter(([s]) => s.state === 'done')).toHaveLength(1);
  });

  it('polls the job about every second while the stream is down, and stops polling when it opens', async () => {
    let state: ServerJobSummary = summary();
    const { api, tick, fetchFn, timers } = setup(() => json(200, state));
    const a = vi.fn();
    api.followJob('j1', a);
    await flush();
    FakeES.instances[0].fire('error');
    expect(timers.find((t) => t.live)?.ms).toBe(1000);
    state = summary({ progress: 0.4 });
    await tick();
    expect(a).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 0.4 }));
    state = summary({ state: 'done', progress: 1 });
    await tick();
    expect(a).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'done' }));
    const before = fetchFn.mock.calls.length;
    expect(timers.some((t) => t.live)).toBe(false);
    expect(fetchFn.mock.calls.length).toBe(before);
  });

  it('does not poll while the stream is up', async () => {
    const { api, timers } = setup(() => json(200, summary()));
    api.followJob('j1', vi.fn());
    FakeES.instances[0].fire('open');
    await flush();
    expect(timers.some((t) => t.live)).toBe(false);
  });
});

describe('getJob, cancelJob, listJobs', () => {
  it('reads a job (null when unknown), cancels with DELETE and lists by scope', async () => {
    const { api, calls } = setup((url, init) => {
      if (init?.method === 'DELETE') return json(200, summary({ state: 'cancelled' }));
      if (url === '/api/jobs/gone') return json(404, { error: 'No job' });
      if (url.startsWith('/api/jobs?')) return json(200, { jobs: [summary()] });
      return json(200, { ...summary({ state: 'done' }), result: { type: 'result' } });
    });
    expect((await api.getJob('j1'))?.result).toEqual({ type: 'result' });
    expect(await api.getJob('gone')).toBeNull();
    await api.cancelJob('j1');
    expect(calls.at(-1)).toMatchObject({ url: '/api/jobs/j1', init: { method: 'DELETE' } });
    expect(await api.listJobs('chart 1')).toHaveLength(1);
    expect(calls.at(-1)?.url).toBe('/api/jobs?scope=chart%201');
  });
});
