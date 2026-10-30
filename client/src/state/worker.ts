/**
 * Web Worker plumbing shared by every store: a tiny promise-based message protocol to the backtest worker,
 * with a main-thread fallback. Each call carries its own request id, so many charts can share one worker.
 */
import { uid } from '../types';
import { runMonteCarlo } from '../lib/backtest/monteCarlo';
import { runAnyBacktest } from '../lib/backtest/runner';
import type { BacktestStage } from '../lib/backtest/types';
import type { WorkerRequestBody, WorkerResponse } from '../lib/workers/backtest.worker';

/** Progress of a call; `stage` is set by backtest runs only. */
export type WorkerProgress = (pct: number, stage?: BacktestStage) => void;

let worker: Worker | null = null;
let workerBroken = false;
const pending = new Map<
  string,
  { resolve: (msg: WorkerResponse) => void; reject: (err: Error) => void; onProgress?: WorkerProgress }
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
        p.onProgress?.(msg.pct, msg.stage);
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

export function workerCall(req: Exclude<WorkerRequestBody, { type: 'optimize' }>, onProgress?: WorkerProgress): Promise<WorkerResponse> {
  const w = getWorker();
  const id = uid('req_');
  if (!w) {
    // Main-thread fallback (e.g. workers unavailable).
    return new Promise((resolve, reject) => {
      try {
        if (req.type === 'run') {
          runAnyBacktest(req.candles, req.config, onProgress).then(
            (result) => resolve({ id, type: 'result', result }),
            (err) => reject(err instanceof Error ? err : new Error(String(err))),
          );
        } else if (req.type === 'montecarlo') {
          resolve({
            id,
            type: 'monteCarloResult',
            result: runMonteCarlo({ trades: req.trades, initialCapital: req.initialCapital }, req.options),
          });
        } else if (req.type === 'pine') {
          // No Worker (e.g. tests): run on this thread. Loaded lazily to keep PineTS out of the main bundle.
          void import('../lib/pine/runtime')
            .then((m) => m.runPine(req.source, req.candles, req.inputs))
            .then((outcome) => resolve({ id, type: 'pineResult', outcome }), reject);
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

/** Rejection of an optimizer run that was cancelled. */
export class CancelledError extends Error {
  constructor() {
    super('Optimizer cancelled');
    this.name = 'AbortError';
  }
}

/**
 * One optimizer run on its own dedicated Worker, created for the call and terminated when it settles or is
 * cancelled. Never touches the shared worker, so cancelling cannot disturb other charts' backtests or Pine runs.
 */
export function optimizerCall(
  req: Extract<WorkerRequestBody, { type: 'optimize' }>,
  onProgress?: (pct: number) => void,
): { promise: Promise<WorkerResponse>; cancel: () => void } {
  let w: Worker;
  try {
    w = new Worker(new URL('../lib/workers/backtest.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return { promise: Promise.reject(new Error('Optimizer requires Web Worker support.')), cancel: () => {} };
  }
  const id = uid('opt_');
  let settled = false;
  let rejectFn: (err: Error) => void = () => {};
  const finish = () => {
    settled = true;
    w.onmessage = null;
    w.onerror = null;
    w.terminate();
  };
  const promise = new Promise<WorkerResponse>((resolve, reject) => {
    rejectFn = reject;
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (settled || msg.id !== id) return;
      if (msg.type === 'progress') {
        onProgress?.(msg.pct);
        return;
      }
      finish();
      if (msg.type === 'error') reject(new Error(msg.message));
      else resolve(msg);
    };
    w.onerror = () => {
      if (settled) return;
      finish();
      reject(new Error('Optimizer worker crashed'));
    };
    w.postMessage({ ...req, id });
  });
  const cancel = () => {
    if (settled) return;
    finish();
    rejectFn(new CancelledError());
  };
  return { promise, cancel };
}
