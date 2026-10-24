/**
 * Backtest Web Worker. Keeps heavy computations (single runs, parameter
 * sweeps) off the UI thread so charts stay responsive even with hundreds of
 * thousands of bars — no server-side limits, no run quotas.
 */
import type { Candle } from '../../types';
import type { OptimizeConfig, OptimizeRow, MetricKey } from '../backtest/optimizer';
import { runOptimize } from '../backtest/optimizer';
import { runFullBacktest } from '../backtest/runner';
import type { BacktestConfig, BacktestResult } from '../backtest/types';
import { runPine } from '../pine/runtime';
import type { PineInputValue, PineRunOutcome } from '../pine/types';

export type WorkerRequest =
  | { id: string; type: 'run'; candles: Candle[]; config: BacktestConfig }
  | { id: string; type: 'optimize'; candles: Candle[]; config: BacktestConfig; optimize: OptimizeConfig }
  | { id: string; type: 'pine'; source: string; candles: Candle[]; inputs?: Record<string, PineInputValue> };

/** Request body without the correlation id (used by workerCall). */
export type WorkerRequestBody =
  | { type: 'run'; candles: Candle[]; config: BacktestConfig }
  | { type: 'optimize'; candles: Candle[]; config: BacktestConfig; optimize: OptimizeConfig }
  | { type: 'pine'; source: string; candles: Candle[]; inputs?: Record<string, PineInputValue> };

export type WorkerResponse =
  | { id: string; type: 'progress'; pct: number }
  | { id: string; type: 'result'; result: BacktestResult }
  | { id: string; type: 'optimizeResult'; rows: OptimizeRow[]; combos: number; metric: MetricKey; errored: number }
  | { id: string; type: 'pineResult'; outcome: PineRunOutcome }
  | { id: string; type: 'error'; message: string };

const ctx = self as unknown as { onmessage: ((ev: MessageEvent) => void) | null; postMessage: (msg: unknown) => void };

ctx.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === 'pine') {
    // Async: runPine never rejects, but guard anyway so the caller always gets a reply.
    runPine(msg.source, msg.candles, msg.inputs)
      .then((outcome) => ctx.postMessage({ id: msg.id, type: 'pineResult', outcome } satisfies WorkerResponse))
      .catch((err) =>
        ctx.postMessage({
          id: msg.id,
          type: 'error',
          message: err instanceof Error ? err.message : String(err),
        } satisfies WorkerResponse),
      );
    return;
  }
  try {
    if (msg.type === 'run') {
      const result = runFullBacktest(msg.candles, msg.config);
      ctx.postMessage({ id: msg.id, type: 'result', result } satisfies WorkerResponse);
      return;
    }
    if (msg.type === 'optimize') {
      const out = runOptimize(msg.candles, msg.config, msg.optimize, (pct) => {
        ctx.postMessage({ id: msg.id, type: 'progress', pct } satisfies WorkerResponse);
      });
      ctx.postMessage({
        id: msg.id,
        type: 'optimizeResult',
        rows: out.rows,
        combos: out.combos,
        metric: out.metric,
        errored: out.errored,
      } satisfies WorkerResponse);
      return;
    }
  } catch (err) {
    ctx.postMessage({
      id: msg.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
