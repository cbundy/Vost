/**
 * High-level backtest runner: signals -> engine -> metrics. Used by the
 * Web Worker and directly by tests.
 */
import type { Candle } from '../../types';
import { runBacktest } from './engine';
import { buyHoldCurve, computeMetrics } from './metrics';
import { runPineBacktest } from './pine';
import { buildSignals, getStrategy } from './strategies';
import type { BacktestConfig, BacktestProgress, BacktestResult } from './types';

export function runFullBacktest(candles: Candle[], config: BacktestConfig, onProgress?: BacktestProgress): BacktestResult {
  if (candles.length < 3) throw new Error('Not enough data to run a backtest (need at least 3 bars).');
  onProgress?.(0, 'signals');
  const signals = buildSignals(candles, config.strategyId, config.params ?? {}, config.customCode);
  onProgress?.(0.2, 'signals');
  const { trades, equity, exposureBars } = runBacktest(
    candles,
    signals,
    config,
    onProgress && ((p) => onProgress(0.2 + p * 0.75, 'simulating')),
  );
  onProgress?.(0.95, 'metrics');
  const metrics = computeMetrics(candles, equity, trades, config.initialCapital, exposureBars);
  onProgress?.(1, 'metrics');
  return { trades, equity, metrics, buyHold: buyHoldCurve(candles, config.initialCapital), config, signals };
}

/** Async entry: Pine scripts run through the Pine runtime, everything else through the signal engine. */
export async function runAnyBacktest(
  candles: Candle[],
  config: BacktestConfig,
  onProgress?: BacktestProgress,
): Promise<BacktestResult> {
  if (getStrategy(config.strategyId).pine) return runPineBacktest(candles, config, onProgress);
  return runFullBacktest(candles, config, onProgress);
}
