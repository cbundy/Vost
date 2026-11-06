/**
 * Backtest Web Worker. Keeps heavy computations (single runs, parameter
 * sweeps) off the UI thread so charts stay responsive even with hundreds of
 * thousands of bars — no server-side limits, no run quotas. The dispatch lives in backtestHandler.ts.
 */
import { createBacktestHandler, type WorkerRequest } from './backtestHandler';

export type { WorkerRequest, WorkerRequestBody, WorkerResponse } from './backtestHandler';

const ctx = self as unknown as { onmessage: ((ev: MessageEvent) => void) | null; postMessage: (msg: unknown) => void };
const handle = createBacktestHandler((m) => ctx.postMessage(m));
ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => handle(ev.data);
