import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { createPool, defaultWorkerCount, ENGINE_BUNDLE, UNAVAILABLE, type PoolWorker } from './pool.ts';

class FakeWorker extends EventEmitter implements PoolWorker {
  sent: unknown[] = [];
  terminated = false;
  postMessage(msg: unknown): void {
    this.sent.push(msg);
  }
  terminate(): void {
    this.terminated = true;
    this.emit('exit', 1);
  }
}

const final = (m: unknown): boolean => (m as { type?: string }).type === 'done';

function setup(opts: { size?: number; answer?: (ask: Record<string, unknown>) => Promise<unknown> } = {}) {
  const workers: FakeWorker[] = [];
  const logs: string[] = [];
  const pool = createPool({
    size: opts.size ?? 2,
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    answer: opts.answer,
    log: (m) => logs.push(m),
    bundleExists: () => true,
  });
  return { pool, workers, logs };
}

describe('job pool', () => {
  it('relays progress and resolves with the final message', async () => {
    const { pool, workers } = setup();
    const seen: unknown[] = [];
    const job = pool.run({ n: 1 }, final, (m) => seen.push(m));
    expect(workers[0].sent).toEqual([{ n: 1 }]);
    workers[0].emit('message', { type: 'progress', pct: 0.5 });
    workers[0].emit('message', { type: 'done', v: 7 });
    await expect(job.done).resolves.toEqual({ type: 'done', v: 7 });
    expect(seen).toEqual([{ type: 'progress', pct: 0.5 }]);
  });

  it('queues requests above the cap and starts them as workers free up, reusing the worker', async () => {
    const { pool, workers } = setup({ size: 1 });
    const a = pool.run('a', final);
    const b = pool.run('b', final);
    expect(workers).toHaveLength(1);
    expect(workers[0].sent).toEqual(['a']);
    workers[0].emit('message', { type: 'done' });
    await a.done;
    expect(workers[0].sent).toEqual(['a', 'b']);
    workers[0].emit('message', { type: 'done', second: true });
    await expect(b.done).resolves.toEqual({ type: 'done', second: true });
    expect(workers).toHaveLength(1);
  });

  it('cancel terminates the worker, rejects the job and gives the next job a fresh worker', async () => {
    const { pool, workers } = setup({ size: 1 });
    const a = pool.run('a', final);
    const b = pool.run('b', final);
    a.cancel();
    await expect(a.done).rejects.toThrow('Cancelled');
    expect(workers[0].terminated).toBe(true);
    expect(workers).toHaveLength(2);
    expect(workers[1].sent).toEqual(['b']);
    workers[1].emit('message', { type: 'done' });
    await b.done;
  });

  it('cancelling a queued job removes it without starting a worker for it', async () => {
    const { pool, workers } = setup({ size: 1 });
    pool.run('a', final);
    const b = pool.run('b', final);
    b.cancel();
    await expect(b.done).rejects.toThrow('Cancelled');
    workers[0].emit('message', { type: 'done' });
    expect(workers[0].sent).toEqual(['a']);
  });

  it('a crash rejects the job and the next job runs on a replacement', async () => {
    const { pool, workers } = setup({ size: 1 });
    const a = pool.run('a', final);
    workers[0].emit('error', new Error('boom'));
    await expect(a.done).rejects.toThrow('engine worker crashed: boom');
    expect(workers[0].terminated).toBe(true);
    const b = pool.run('b', final);
    expect(workers).toHaveLength(2);
    expect(workers[1].sent).toEqual(['b']);
    workers[1].emit('message', { type: 'done' });
    await b.done;
  });

  it('an unexpected exit rejects the job', async () => {
    const { pool, workers } = setup();
    const a = pool.run('a', final);
    workers[0].emit('exit', 3);
    await expect(a.done).rejects.toThrow('exited with code 3');
  });

  it('answers a worker ask through the answerer, and an answerer failure as an error answer', async () => {
    const { pool, workers } = setup({
      answer: async (ask) => {
        if (ask.kind === 'bad') throw new Error('no such thing');
        return { got: ask.kind };
      },
    });
    pool.run('a', final);
    workers[0].emit('message', { proto: 'ask', rid: 4, kind: 'history' });
    workers[0].emit('message', { proto: 'ask', rid: 5, kind: 'bad' });
    await new Promise((r) => setTimeout(r, 10));
    expect(workers[0].sent).toContainEqual({ proto: 'answer', rid: 4, ok: true, value: { got: 'history' } });
    expect(workers[0].sent).toContainEqual({ proto: 'answer', rid: 5, ok: false, error: 'no such thing' });
  });

  it('reports a missing bundle on each job and never throws', async () => {
    const logs: string[] = [];
    const pool = createPool({ size: 1, log: (m) => logs.push(m), bundleExists: () => false });
    await expect(pool.run('a', final).done).rejects.toThrow(UNAVAILABLE);
    await expect(pool.run('b', final).done).rejects.toThrow(UNAVAILABLE);
    expect(logs).toEqual([UNAVAILABLE, UNAVAILABLE]);
    expect(UNAVAILABLE).toBe('server jobs unavailable: run npm run build');
    expect(ENGINE_BUNDLE.endsWith('server/dist/engine.mjs')).toBe(true);
  });

  it('close rejects running and queued jobs and ends the workers', async () => {
    const { pool, workers } = setup({ size: 1 });
    const a = pool.run('a', final);
    const b = pool.run('b', final);
    pool.close();
    await expect(a.done).rejects.toThrow('closed');
    await expect(b.done).rejects.toThrow('closed');
    expect(workers[0].terminated).toBe(true);
  });
});

describe('VOST_JOB_WORKERS', () => {
  it('takes a positive integer', () => {
    expect(defaultWorkerCount({ VOST_JOB_WORKERS: '3' })).toBe(3);
  });
  it.each(['0', '-2', '1.5', 'abc', ''])('ignores %j and uses the default', (v) => {
    const d = defaultWorkerCount({});
    expect(d).toBeGreaterThanOrEqual(1);
    expect(defaultWorkerCount({ VOST_JOB_WORKERS: v })).toBe(d);
  });
});
