/**
 * High-level backtest runner: signals -> engine -> metrics. Used by the
 * Web Worker and directly by tests.
 */
import type { Candle } from '../../types';
import { runBacktest } from './engine';
import { buyHoldCurve, computeMetrics } from './metrics';
import type { PineEnv } from '../pine/runtime';
import { runPineBacktest } from './pine';
import { computePineRoleContext, rolesInUse, withoutSources, type PineRoleContext } from './pineRole';
import { buildSignals, getStrategy } from './strategies';
import type { BacktestConfig, BacktestProgress, BacktestResult } from './types';

/** `ctx` holds the computed TradingView indicator values (Composed roles); build it with `runAnyBacktest`. */
export function runFullBacktest(candles: Candle[], config: BacktestConfig, onProgress?: BacktestProgress, ctx?: PineRoleContext): BacktestResult {
  if (candles.length < 3) throw new Error('Not enough data to run a backtest (need at least 3 bars).');
  if (!ctx && rolesInUse(config).length > 0) throw new Error('TradingView indicator roles need the async runner');
  onProgress?.(0, 'signals');
  const signals = buildSignals(candles, config.strategyId, config.params ?? {}, config.customCode, ctx);
  onProgress?.(0.2, 'signals');
  const { trades, equity, exposureBars, signalsFired } = runBacktest(
    candles,
    signals,
    config,
    onProgress && ((p) => onProgress(0.2 + p * 0.75, 'simulating')),
    ctx && (ctx.stop || ctx.target) ? { ...(ctx.stop && { stop: ctx.stop }), ...(ctx.target && { target: ctx.target }) } : undefined,
  );
  onProgress?.(0.95, 'metrics');
  const metrics = computeMetrics(candles, equity, trades, config.initialCapital, exposureBars, signalsFired);
  onProgress?.(1, 'metrics');
  const filters = getStrategy(config.strategyId).report?.(candles, config.params ?? {}, ctx);
  // The indicator sources only travel with the request: the result's config carries none.
  const kept = config.pineRoles ? { ...config, pineRoles: withoutSources(config.pineRoles) } : config;
  return { trades, equity, metrics, buyHold: buyHoldCurve(candles, config.initialCapital), config: kept, signals, ...(filters ? { filters } : {}) };
}

/** Async entry: Pine scripts run through the Pine runtime, everything else through the signal engine. */
export async function runAnyBacktest(
  candles: Candle[],
  config: BacktestConfig,
  onProgress?: BacktestProgress,
  pine?: PineEnv,
): Promise<BacktestResult> {
  if (getStrategy(config.strategyId).pine) return runPineBacktest(candles, config, onProgress, pine);
  const roles = rolesInUse(config);
  if (roles.length === 0) return runFullBacktest(candles, config, onProgress);
  onProgress?.(0, 'pine');
  const ctx = await computePineRoleContext(candles, roles, config.market, pine);
  return runFullBacktest(candles, config, onProgress, ctx);
}
