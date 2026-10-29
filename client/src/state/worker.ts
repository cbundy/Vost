/**
 * Web Worker plumbing shared by every store: a tiny promise-based message protocol to the backtest worker,
 * with a main-thread fallback. Each call carries its own request id, so many charts can share one worker.
 */
import { uid } from '../types';
import { runAnyBacktest } from '../lib/backtest/runner';
import type { WorkerRequestBody, WorkerResponse } from '../lib/workers/backtest.worker';

let worker: Worker | null = null;
let workerBroken = false;
const pending = new Map<
  string,
  { resolve: (msg: WorkerResponse) => void; reject: (err: Error) => void; onProgress?: (pct: number) => void }
>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../lib/workers/backtest.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.type === 'progress') {
        p.onProgress?.(msg.pct);
        return;
      }
      pending.delete(msg.id);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
    };
    worker.onerror = () => {
      workerBroken = true;
      for (const [, p] of pending) p.reject(new Error('Backtest worker crashed — falling back to main thread'));
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    workerBroken = true;
    worker = null;
    return null;
  }
}

export function workerCall(req: WorkerRequestBody, onProgress?: (pct: number) => void): Promise<WorkerResponse> {
  const w = getWorker();
  const id = uid('req_');
  if (!w) {
    // Main-thread fallback (e.g. workers unavailable).
    return new Promise((resolve, reject) => {
      try {
        if (req.type === 'run') {
          runAnyBacktest(req.candles, req.config).then(
            (result) => resolve({ id, type: 'result', result }),
            (err) => reject(err instanceof Error ? err : new Error(String(err))),
          );
        } else if (req.type === 'pine') {
          // No Worker (e.g. tests): run on this thread. Loaded lazily to keep PineTS out of the main bundle.
          void import('../lib/pine/runtime')
            .then((m) => m.runPine(req.source, req.candles, req.inputs))
            .then((outcome) => resolve({ id, type: 'pineResult', outcome }), reject);
        } else {
          reject(new Error('Optimizer requires Web Worker support.'));
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    w.postMessage({ ...req, id });
  });
}
