/**
 * A pool of worker threads that run the engine bundle (server/dist/engine.mjs, made by `npm run build`).
 * Messages are opaque here: the pool does not know the engine's protocol except for the envelope of the
 * worker's asks (`{ proto: 'ask', rid, ... }`, answered with `{ proto: 'answer', rid, ok, value | error }`).
 *
 * Up to `size` workers each run one request at a time; the rest wait in a queue. Cancelling or a crash ends the
 * worker, and the next job gets a fresh one; a finished job leaves its worker idle for reuse.
 */
import { existsSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

/** What the pool needs of a worker (a `worker_threads` Worker satisfies it). */
export interface PoolWorker {
  postMessage(msg: unknown): void;
  terminate(): unknown;
  on(event: 'message', listener: (msg: unknown) => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
}

export const ENGINE_BUNDLE = fileURLToPath(new URL('./../dist/engine.mjs', import.meta.url));
export const UNAVAILABLE = 'server jobs unavailable: run npm run build';

export function defaultWorkerCount(env: Record<string, string | undefined> = process.env): number {
  const raw = env.VOST_JOB_WORKERS?.trim();
  if (raw && /^[1-9][0-9]*$/.test(raw)) return Number(raw);
  return Math.max(1, os.availableParallelism() - 1);
}

export interface PoolOptions {
  /** Max workers (default: `defaultWorkerCount()`). */
  size?: number;
  /** Makes a worker; the default loads the bundle. Throws when it cannot. */
  createWorker?: () => PoolWorker;
  /** Answers an ask of the worker (a lookup it may not make itself); a throw becomes an error answer. */
  answer?: (ask: Record<string, unknown>) => Promise<unknown>;
  /** Where the missing-bundle message goes (default: console.error). */
  log?: (message: string) => void;
  /** Whether the bundle exists (default: a file check). */
  bundleExists?: () => boolean;
}

export interface JobHandle {
  /** Settles with the final message (the one `isFinal` accepts); rejects when the job is cancelled, crashes or the pool is unavailable. */
  done: Promise<unknown>;
  cancel(): void;
}

interface Job {
  request: unknown;
  isFinal: (msg: unknown) => boolean;
  onMessage?: (msg: unknown) => void;
  resolve: (msg: unknown) => void;
  reject: (err: Error) => void;
  worker?: PoolWorker;
  settled: boolean;
}

export interface Pool {
  readonly size: number;
  run(request: unknown, isFinal: (msg: unknown) => boolean, onMessage?: (msg: unknown) => void): JobHandle;
  /** Ends every worker and rejects the jobs. */
  close(): void;
}

export function createPool(opts: PoolOptions = {}): Pool {
  const size = opts.size ?? defaultWorkerCount();
  const log = opts.log ?? ((m) => console.error(m));
  const exists = opts.bundleExists ?? (() => existsSync(ENGINE_BUNDLE));
  const make = opts.createWorker ?? (() => new Worker(ENGINE_BUNDLE) as unknown as PoolWorker);
  const queue: Job[] = [];
  const running = new Set<Job>();
  let closed = false;

  const settle = (job: Job, fn: () => void): void => {
    if (job.settled) return;
    job.settled = true;
    fn();
  };

  const idle: PoolWorker[] = [];
  const jobOf = new Map<PoolWorker, Job>();

  /** Frees the job's worker: a killed one is dropped (the next job makes a fresh one), a healthy one is reused. */
  function release(job: Job, kill: boolean): void {
    running.delete(job);
    const worker = job.worker;
    job.worker = undefined;
    if (worker) {
      jobOf.delete(worker);
      if (kill || closed) worker.terminate();
      else idle.push(worker);
    }
    pump();
  }

  function spawn(): PoolWorker {
    if (!exists()) throw new Error(UNAVAILABLE);
    const worker = make();
    worker.on('message', (msg) => {
      const job = jobOf.get(worker);
      if (!job || job.settled) return;
      const m = msg as { proto?: unknown; rid?: unknown } | null;
      if (m && m.proto === 'ask') {
        const rid = m.rid;
        const reply = (body: Record<string, unknown>): void => {
          if (!job.settled && job.worker === worker) worker.postMessage({ proto: 'answer', rid, ...body });
        };
        const answer = opts.answer;
        if (!answer) return reply({ ok: false, error: 'no answerer for this ask' });
        Promise.resolve()
          .then(() => answer(m as Record<string, unknown>))
          .then((value) => reply({ ok: true, value }), (err) => reply({ ok: false, error: err instanceof Error ? err.message : String(err) }));
        return;
      }
      if (job.isFinal(msg)) {
        settle(job, () => job.resolve(msg));
        release(job, false);
        return;
      }
      job.onMessage?.(msg);
    });
    const crashed = (why: string): void => {
      const job = jobOf.get(worker);
      const at = idle.indexOf(worker);
      if (at >= 0) idle.splice(at, 1);
      if (!job || job.settled) return;
      settle(job, () => job.reject(new Error(why)));
      release(job, true);
    };
    worker.on('error', (err) => crashed(`engine worker crashed: ${err.message}`));
    worker.on('exit', (code) => crashed(`engine worker exited with code ${code}`));
    return worker;
  }

  function start(job: Job): void {
    let worker = idle.pop();
    if (!worker) {
      try {
        worker = spawn();
      } catch (e) {
        const message = e instanceof Error && e.message === UNAVAILABLE ? UNAVAILABLE : `server jobs unavailable: ${e instanceof Error ? e.message : String(e)}`;
        log(message);
        settle(job, () => job.reject(new Error(message)));
        return;
      }
    }
    job.worker = worker;
    jobOf.set(worker, job);
    running.add(job);
    worker.postMessage(job.request);
  }

  function pump(): void {
    while (!closed && running.size < size && queue.length > 0) start(queue.shift()!);
  }

  return {
    size,
    run(request, isFinal, onMessage) {
      let job!: Job;
      const done = new Promise<unknown>((resolve, reject) => {
        job = { request, isFinal, onMessage, resolve, reject, settled: false };
      });
      if (closed) {
        settle(job, () => job.reject(new Error('the job pool is closed')));
      } else {
        queue.push(job);
        pump();
      }
      return {
        done,
        cancel() {
          const at = queue.indexOf(job);
          if (at >= 0) queue.splice(at, 1);
          settle(job, () => job.reject(new Error('Cancelled')));
          if (running.has(job)) release(job, true);
        },
      };
    },
    close() {
      closed = true;
      for (const job of queue.splice(0)) settle(job, () => job.reject(new Error('the job pool is closed')));
      for (const w of idle.splice(0)) w.terminate();
      for (const job of [...running]) {
        settle(job, () => job.reject(new Error('the job pool is closed')));
        release(job, true);
      }
    },
  };
}
