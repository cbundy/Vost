/**
 * The backtest worker's dispatch, free of any worker global so the browser worker and the server's engine bundle
 * (`client/src/strategyMaker/serverEngine`) share it. `opts` carries the Pine resolver and feed the server bundle injects.
 */
import type { Candle } from '../../types';
import type { MarketFeed } from '../pine/marketFeed';
import type { ImportResolverFn, IImportResolver } from 'pinets';
import type { OptimizeConfig, OptimizeRow, MetricKey } from '../backtest/optimizer';
import { runMonteCarlo, type MonteCarloOptions, type MonteCarloResult } from '../backtest/monteCarlo';
import { runValidatedOptimize, type ValidationOutput } from '../backtest/validation';
import type { WalkForwardOutput } from '../backtest/walkForward';
import { runAnyBacktest } from '../backtest/runner';
import type { BacktestConfig, BacktestResult, BacktestStage, Trade } from '../backtest/types';
import { runPine } from '../pine/runtime';
import type { PineCalculation, PineInputValue, PineMarket, PineRunOutcome } from '../pine/types';

export type WorkerRequest =
  | { id: string; type: 'run'; candles: Candle[]; config: BacktestConfig }
  | { id: string; type: 'optimize'; candles: Candle[]; config: BacktestConfig; optimize: OptimizeConfig }
  | { id: string; type: 'pine'; source: string; candles: Candle[]; inputs?: Record<string, PineInputValue>; market?: PineMarket; calculation?: PineCalculation }
  | { id: string; type: 'montecarlo'; trades: Trade[]; initialCapital: number; options: MonteCarloOptions };

/** Request body without the correlation id (used by workerCall). */
export type WorkerRequestBody =
  | { type: 'run'; candles: Candle[]; config: BacktestConfig }
  | { type: 'optimize'; candles: Candle[]; config: BacktestConfig; optimize: OptimizeConfig }
  | { type: 'pine'; source: string; candles: Candle[]; inputs?: Record<string, PineInputValue>; market?: PineMarket; calculation?: PineCalculation }
  | { type: 'montecarlo'; trades: Trade[]; initialCapital: number; options: MonteCarloOptions };

export type WorkerResponse =
  | { id: string; type: 'progress'; pct: number; stage?: BacktestStage }
  | { id: string; type: 'result'; result: BacktestResult }
  | { id: string; type: 'optimizeResult'; rows: OptimizeRow[]; keys: string[]; combos: number; metric: MetricKey; errored: number; validation?: ValidationOutput; walkForward?: WalkForwardOutput }
  | { id: string; type: 'pineResult'; outcome: PineRunOutcome }
  | { id: string; type: 'monteCarloResult'; result: MonteCarloResult }
  | { id: string; type: 'error'; message: string };

export interface BacktestHandlerOptions {
  /** Finds the source of an imported Pine library (default: the Vost server over HTTP). */
  resolver?: ImportResolverFn | IImportResolver;
  /** Where Pine reads other timeframes' bars (default: the realm's feed). */
  feed?: MarketFeed;
}

/** Returns the function that answers one request through `post`. */
export function createBacktestHandler(post: (m: WorkerResponse) => void, opts: BacktestHandlerOptions = {}): (msg: WorkerRequest) => void {
  return (msg) => {
    if (msg.type === 'pine') {
      // Async: runPine never rejects, but guard anyway so the caller always gets a reply.
      runPine(msg.source, msg.candles, msg.inputs, { market: msg.market, calculation: msg.calculation, ...(opts.resolver && { resolver: opts.resolver }), ...(opts.feed && { feed: opts.feed }) })
        .then((outcome) => post({ id: msg.id, type: 'pineResult', outcome }))
        .catch((err) => post({ id: msg.id, type: 'error', message: err instanceof Error ? err.message : String(err) }));
      return;
    }
    const reply = post;
    const fail = (err: unknown) =>
      reply({ id: msg.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
    if (msg.type === 'montecarlo') {
      try {
        reply({ id: msg.id, type: 'monteCarloResult', result: runMonteCarlo({ trades: msg.trades, initialCapital: msg.initialCapital }, msg.options) });
      } catch (err) {
        fail(err);
      }
      return;
    }
    if (msg.type === 'run') {
      runAnyBacktest(msg.candles, msg.config, (pct, stage) => reply({ id: msg.id, type: 'progress', pct, stage }))
        .then((result) => reply({ id: msg.id, type: 'result', result }))
        .catch(fail);
      return;
    }
    if (msg.type === 'optimize') {
      runValidatedOptimize(msg.candles, msg.config, msg.optimize, (pct) => reply({ id: msg.id, type: 'progress', pct }))
        .then((out) =>
          reply({
            id: msg.id,
            type: 'optimizeResult',
            rows: out.rows,
            keys: out.keys,
            combos: out.combos,
            metric: out.metric,
            errored: out.errored,
            validation: out.validation,
            walkForward: out.walkForward,
          }),
        )
        .catch(fail);
    }
  };
}
