/**
 * High-level backtest runner: signals -> engine -> metrics. Used by the
 * Web Worker and directly by tests.
 */
import type { Candle } from '../../types';
import { runBacktest } from './engine';
import { computeMetrics } from './metrics';
import { runPineBacktest } from './pine';
import { buildSignals, getStrategy } from './strategies';
import type { BacktestConfig, BacktestResult } from './types';

export function runFullBacktest(candles: Candle[], config: BacktestConfig): BacktestResult {
  if (candles.length < 3) throw new Error('Not enough data to run a backtest (need at least 3 bars).');
  const signals = buildSignals(candles, config.strategyId, config.params ?? {}, config.customCode);
  const { trades, equity, exposureBars } = runBacktest(candles, signals, config);
  const metrics = computeMetrics(candles, equity, trades, config.initialCapital, exposureBars);
  return { trades, equity, metrics, config, signals };
}

/** Async entry: Pine scripts run through the Pine runtime, everything else through the signal engine. */
export async function runAnyBacktest(candles: Candle[], config: BacktestConfig): Promise<BacktestResult> {
  if (getStrategy(config.strategyId).pine) return runPineBacktest(candles, config);
  return runFullBacktest(candles, config);
}
