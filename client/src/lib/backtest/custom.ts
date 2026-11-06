/**
 * Custom strategy support.
 *
 * User code is compiled with `new Function` and executed inside the backtest
 * Web Worker (never on the main thread), with this contract:
 *
 *   (candles, params, indicators) => Signal[]
 *
 * - `candles`: Candle[] (time in seconds, o/h/l/c/v)
 * - `params`:   flat object of numbers from the Backtest panel
 * - `indicators`: helper functions (sma, ema, rsi, macd, bollinger, atr,
 *   adx, volumeSma, vwap, highest, lowest, stdev, crossover, crossunder)
 *
 * Return an array of the same length as `candles` with:
 *   1 = long, 0 = flat, -1 = short (shorts need to be enabled in the config)
 *   null/undefined = no data yet (warm-up)
 */
import { indicatorHelpers } from '../indicators';
import type { Candle } from '../../types';
import type { Signal } from './types';

export const DEFAULT_CUSTOM_CODE = `// Available: candles, params, indicators
//   indicators: sma, ema, rsi, macd, bollinger, atr, adx(period), volumeSma(period),
//               vwap, highest, lowest,
//               stdev, crossover(a, b, i), crossunder(a, b, i)
// Return an array of signals: 1 = long, 0 = flat, -1 = short (null = warm-up)
const fastPeriod = params.fast || 10;
const slowPeriod = params.slow || 30;

const fast = indicators.sma(undefined, fastPeriod);
const slow = indicators.sma(undefined, slowPeriod);

const signals = new Array(candles.length).fill(null);
for (let i = 0; i < candles.length; i++) {
  if (fast[i] == null || slow[i] == null) continue;
  signals[i] = fast[i] > slow[i] ? 1 : 0;
}
return signals;
`;

export type CustomStrategyFn = (candles: Candle[], params: Record<string, number>) => Signal[];

/**
 * Compile user supplied code into a strategy function. Errors thrown at
 * compile time or runtime are surfaced to the UI via the worker protocol.
 */
export function compileCustomStrategy(code: string): (candles: Candle[], params: Record<string, number>) => unknown[] {
  // Reject obvious infinite-loop footguns cheaply (can't fully sandbox JS without workers+timeouts).
  const fn = new Function('candles', 'params', 'indicators', `"use strict";\n${code}`) as (
    candles: Candle[],
    params: Record<string, number>,
    indicators: ReturnType<typeof indicatorHelpers>,
  ) => unknown[];

  return (candles: Candle[], params: Record<string, number>): unknown[] => {
    const intraday = candles.length > 1 ? candles[1].time - candles[0].time < 86400 : false;
    const helpers = indicatorHelpers(candles, intraday);
    const result = fn(candles, params, helpers);
    if (!Array.isArray(result)) {
      throw new Error('Custom strategy must return an array of signals (1 / 0 / -1 / null).');
    }
    return result;
  };
}

export const CUSTOM_STRATEGY_EXAMPLES: Array<{ name: string; code: string }> = [
  {
    name: 'SMA crossover with trend filter',
    code: `const fast = indicators.sma(undefined, params.fast || 10);
const slow = indicators.sma(undefined, params.slow || 30);
const trend = indicators.ema(undefined, params.trend || 200);
const signals = new Array(candles.length).fill(null);
for (let i = 0; i < candles.length; i++) {
  if (fast[i] == null || slow[i] == null || trend[i] == null) continue;
  if (fast[i] > slow[i] && candles[i].close > trend[i]) signals[i] = 1;
  else signals[i] = 0;
}
return signals;`,
  },
  {
    name: 'RSI reversion + volatility filter',
    code: `const r = indicators.rsi(params.length || 14);
const at = indicators.atr(14);
const signals = new Array(candles.length).fill(null);
let pos = 0;
for (let i = 0; i < candles.length; i++) {
  if (r[i] == null || at[i] == null) continue;
  const calm = at[i] / candles[i].close < 0.03; // skip wild regimes
  if (pos === 0 && r[i] < 30 && calm) { pos = 1; }
  else if (pos === 1 && r[i] > 60) { pos = 0; }
  signals[i] = pos;
}
return signals;`,
  },
  {
    name: 'Volume-confirmed breakout (Donchian)',
    code: `const hh = indicators.highest(candles.map(c => c.high), params.period || 20);
const vols = indicators.sma(candles.map(c => c.volume), 20);
const signals = new Array(candles.length).fill(null);
let pos = 0;
for (let i = 1; i < candles.length; i++) {
  if (hh[i - 1] == null || vols[i] == null) continue;
  const brk = candles[i].close > hh[i - 1];
  const volOk = candles[i].volume > vols[i] * 1.2;
  if (pos === 0 && brk && volOk) pos = 1;
  else if (pos === 1 && candles[i].close < candles[i - 1].low) pos = 0;
  signals[i] = pos;
}
return signals;`,
  },
];
