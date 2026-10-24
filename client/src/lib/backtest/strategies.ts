/**
 * Built-in strategy library. Each strategy turns candles + parameters into a
 * per-bar target exposure array (`Signal[]`):
 *
 *   1   = want to be long at that bar's close
 *   0   = want to be flat
 *  -1   = want to be short (only if shorts are enabled in the config)
 *  null = warm-up, not enough data yet
 *
 * The engine executes the value of bar `i` at the open of bar `i + 1`, so a
 * strategy only ever sees data up to and including bar `i` — no look-ahead.
 */
import type { Candle } from '../../types';
import { bollinger, crossover, crossunder, ema, highest, lowest, macd, rsi, sma } from '../indicators';
import { compileCustomStrategy, DEFAULT_CUSTOM_CODE } from './custom';
import type { Signal } from './types';

export interface ParamSpec {
  key: string;
  label: string;
  type: 'int' | 'float' | 'select';
  default: number;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: number; label: string }>;
  hint?: string;
}

export type Direction = 1 | 2 | 3; // 1 = long only, 2 = short only, 3 = both

const DIRECTION_OPTIONS = [
  { value: 1, label: 'Long only' },
  { value: 2, label: 'Short only' },
  { value: 3, label: 'Both' },
];

function directional(level: boolean, direction: Direction): Signal {
  if (direction === 1) return level ? 1 : 0;
  if (direction === 2) return level ? 0 : -1;
  return level ? 1 : -1;
}

export interface StrategyDef {
  id: string;
  name: string;
  description: string;
  params: ParamSpec[];
  custom?: boolean;
  /** Pine Script strategy: runs through the Pine runtime, params are the script's inputs. */
  pine?: boolean;
  build(candles: Candle[], params: Record<string, number>): Signal[];
}

/* ------------------------------------------------------------------ */

const buyHold: StrategyDef = {
  id: 'buy_hold',
  name: 'Buy & hold',
  description: 'Buys at the first bar open and holds until the end. The benchmark every strategy must beat.',
  params: [],
  build(candles) {
    // "Long" from the very first bar's close => the engine fills at the open
    // of bar 1, the earliest possible entry.
    return new Array(candles.length).fill(1) as Signal[];
  },
};

const smaCross: StrategyDef = {
  id: 'sma_cross',
  name: 'SMA crossover',
  description: 'Classic golden/death cross: long while the fast SMA is above the slow SMA.',
  params: [
    { key: 'fast', label: 'Fast period', type: 'int', default: 10, min: 1, max: 500 },
    { key: 'slow', label: 'Slow period', type: 'int', default: 30, min: 2, max: 1000 },
    { key: 'direction', label: 'Direction', type: 'select', default: 1, options: DIRECTION_OPTIONS },
  ],
  build(candles, p) {
    const closes = candles.map((c) => c.close);
    const fast = sma(closes, int(p.fast, 10));
    const slow = sma(closes, int(p.slow, 30));
    const dir = direction(p.direction);
    return closes.map((_, i) => {
      const f = fast[i];
      const s = slow[i];
      if (f == null || s == null) return null;
      return directional(f > s, dir);
    });
  },
};

const emaCross: StrategyDef = {
  id: 'ema_cross',
  name: 'EMA crossover',
  description: 'Fast EMA vs slow EMA crossover — reacts sooner than SMAs.',
  params: [
    { key: 'fast', label: 'Fast period', type: 'int', default: 12, min: 1, max: 500 },
    { key: 'slow', label: 'Slow period', type: 'int', default: 26, min: 2, max: 1000 },
    { key: 'direction', label: 'Direction', type: 'select', default: 1, options: DIRECTION_OPTIONS },
  ],
  build(candles, p) {
    const closes = candles.map((c) => c.close);
    const fast = ema(closes, int(p.fast, 12));
    const slow = ema(closes, int(p.slow, 26));
    const dir = direction(p.direction);
    return closes.map((_, i) => {
      const f = fast[i];
      const s = slow[i];
      if (f == null || s == null) return null;
      return directional(f > s, dir);
    });
  },
};

const macdCross: StrategyDef = {
  id: 'macd_cross',
  name: 'MACD',
  description: 'Long while the MACD line is above its signal line (histogram > 0).',
  params: [
    { key: 'fast', label: 'Fast EMA', type: 'int', default: 12, min: 1, max: 200 },
    { key: 'slow', label: 'Slow EMA', type: 'int', default: 26, min: 2, max: 400 },
    { key: 'signal', label: 'Signal EMA', type: 'int', default: 9, min: 1, max: 200 },
    { key: 'direction', label: 'Direction', type: 'select', default: 1, options: DIRECTION_OPTIONS },
  ],
  build(candles, p) {
    const closes = candles.map((c) => c.close);
    const { histogram } = macd(closes, int(p.fast, 12), int(p.slow, 26), int(p.signal, 9));
    const dir = direction(p.direction);
    return closes.map((_, i) => {
      const h = histogram[i];
      if (h == null) return null;
      return directional(h > 0, dir);
    });
  },
};

const rsiReversion: StrategyDef = {
  id: 'rsi_reversion',
  name: 'RSI mean reversion',
  description: 'Enter long when RSI crosses back up through oversold; exit when it crosses above the overbought level (mirrored for shorts).',
  params: [
    { key: 'length', label: 'RSI length', type: 'int', default: 14, min: 2, max: 200 },
    { key: 'oversold', label: 'Oversold', type: 'float', default: 30, min: 1, max: 49, step: 1 },
    { key: 'overbought', label: 'Overbought', type: 'float', default: 70, min: 51, max: 99, step: 1 },
    { key: 'direction', label: 'Direction', type: 'select', default: 1, options: DIRECTION_OPTIONS },
  ],
  build(candles, p) {
    const closes = candles.map((c) => c.close);
    const r = rsi(closes, int(p.length, 14));
    const oversold = num(p.oversold, 30);
    const overbought = num(p.overbought, 70);
    const dir = direction(p.direction);
    const oversoldLine = constSeries(oversold, candles.length);
    const overboughtLine = constSeries(overbought, candles.length);
    const out: Signal[] = new Array(candles.length).fill(null);
    let pos: -1 | 0 | 1 = 0;
    for (let i = 0; i < candles.length; i++) {
      const v = r[i];
      if (v == null) continue;
      if (dir !== 2) {
        // long side: enter on the cross back up through oversold, exit past overbought
        if (pos === 0 && crossover(r, oversoldLine, i)) pos = 1;
        else if (pos === 1 && v > overbought) pos = 0;
      }
      if (dir !== 1) {
        // short side: mirror image
        if (pos === 0 && crossunder(r, overboughtLine, i)) pos = -1;
        else if (pos === -1 && v < oversold) pos = 0;
      }
      out[i] = pos;
    }
    return out;
  },
};

const bollingerStrategy: StrategyDef = {
  id: 'bollinger',
  name: 'Bollinger Bands',
  description: 'Breakout (buy the upper-band break) or mean reversion (buy the lower band touch), exits at the middle band.',
  params: [
    { key: 'length', label: 'Length', type: 'int', default: 20, min: 2, max: 400 },
    { key: 'mult', label: 'Std dev mult', type: 'float', default: 2, min: 0.1, max: 6, step: 0.1 },
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: 'Breakout' },
        { value: 1, label: 'Mean reversion' },
      ],
    },
    { key: 'direction', label: 'Direction', type: 'select', default: 1, options: DIRECTION_OPTIONS },
  ],
  build(candles, p) {
    const closes = candles.map((c) => c.close);
    const { upper, middle, lower } = bollinger(closes, int(p.length, 20), num(p.mult, 2));
    const mode = Math.round(num(p.mode, 0));
    const dir = direction(p.direction);
    const out: Signal[] = new Array(candles.length).fill(null);
    let pos: -1 | 0 | 1 = 0;
    for (let i = 0; i < candles.length; i++) {
      const c = closes[i];
      const u = upper[i];
      const m = middle[i];
      const l = lower[i];
      if (u == null || m == null || l == null) continue;
      if (dir !== 2) {
        if (pos === 0) {
          if (mode === 0 ? c > u : c < l) pos = 1;
        } else if (pos === 1) {
          if (mode === 0 ? c < m : c > m) pos = 0;
        }
      }
      if (dir !== 1) {
        if (pos === 0) {
          if (mode === 0 ? c < l : c > u) pos = -1;
        } else if (pos === -1) {
          if (mode === 0 ? c > m : c < m) pos = 0;
        }
      }
      out[i] = pos;
    }
    return out;
  },
};

const donchian: StrategyDef = {
  id: 'donchian',
  name: 'Donchian breakout',
  description: 'Turtle-style channel breakout: buy a new N-bar high, exit on a new M-bar low.',
  params: [
    { key: 'entry', label: 'Entry period', type: 'int', default: 20, min: 2, max: 400 },
    { key: 'exit', label: 'Exit period', type: 'int', default: 10, min: 1, max: 400 },
    { key: 'direction', label: 'Direction', type: 'select', default: 1, options: DIRECTION_OPTIONS },
  ],
  build(candles, p) {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const hh = highest(highs, int(p.entry, 20));
    const ll = lowest(lows, int(p.exit, 10));
    const lEntry = lowest(lows, int(p.entry, 20));
    const hhExit = highest(highs, int(p.exit, 10));
    const closes = candles.map((c) => c.close);
    const dir = direction(p.direction);
    const out: Signal[] = new Array(candles.length).fill(null);
    let pos: -1 | 0 | 1 = 0;
    for (let i = 1; i < candles.length; i++) {
      const upLevel = hh[i - 1];
      const downLevel = ll[i - 1];
      const downBreak = lEntry[i - 1];
      const upBreak = hhExit[i - 1];
      if (upLevel == null || downLevel == null || downBreak == null || upBreak == null) continue;
      const c = closes[i];
      if (dir !== 2) {
        if (pos === 0 && c > upLevel) pos = 1;
        else if (pos === 1 && c < downLevel) pos = 0;
      }
      if (dir !== 1) {
        if (pos === 0 && c < downBreak) pos = -1;
        else if (pos === -1 && c > upBreak) pos = 0;
      }
      out[i] = pos;
    }
    return out;
  },
};

const customStrategy: StrategyDef = {
  id: 'custom',
  name: 'Custom (JavaScript)',
  description: 'Write your own signal logic. Code runs in a Web Worker with indicator helpers available.',
  custom: true,
  params: [],
  build(candles, p) {
    const code = (p as unknown as { __code?: string }).__code ?? DEFAULT_CUSTOM_CODE;
    const raw = compileCustomStrategy(code)(candles, p);
    return normalizeSignals(raw, candles.length);
  },
};

/* ------------------------------------------------------------------ */

const pineStrategy: StrategyDef = {
  id: 'pine',
  name: 'Pine Script',
  description: 'Run a Pine Script v6 strategy() script. Its input.* declarations become parameters.',
  params: [],
  pine: true,
  build(candles) {
    return new Array(candles.length).fill(null) as Signal[];
  },
};

export const strategies: StrategyDef[] = [
  smaCross,
  emaCross,
  macdCross,
  rsiReversion,
  bollingerStrategy,
  donchian,
  buyHold,
  customStrategy,
  pineStrategy,
];

export function getStrategy(id: string): StrategyDef {
  return strategies.find((s) => s.id === id) ?? strategies[0];
}

/** Build the signal array for a strategy + config (throws on custom-code errors). */
export function buildSignals(candles: Candle[], strategyId: string, params: Record<string, number>, customCode?: string): Signal[] {
  const strategy = getStrategy(strategyId);
  if (strategy.custom) {
    const merged = { ...params, __code: customCode ?? DEFAULT_CUSTOM_CODE } as unknown as Record<string, number>;
    const raw = compileCustomStrategy(customCode ?? DEFAULT_CUSTOM_CODE)(candles, merged);
    return normalizeSignals(raw, candles.length);
  }
  const raw = strategy.build(candles, params);
  return normalizeSignals(raw, candles.length);
}

/** Coerce arbitrary strategy output into a valid Signal[] of the right length. */
export function normalizeSignals(raw: unknown, length: number): Signal[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: Signal[] = new Array(length).fill(null);
  for (let i = 0; i < Math.min(length, arr.length); i++) {
    const v = arr[i] as unknown;
    if (v == null) continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) continue;
    out[i] = n > 0 ? 1 : n < 0 ? -1 : 0;
  }
  return out;
}

/* ------------------------- small helpers --------------------------- */

function int(v: number | undefined, fallback: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function num(v: number | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function direction(v: number | undefined): Direction {
  const n = Math.round(Number(v));
  return n === 2 ? 2 : n === 3 ? 3 : 1;
}

function constSeries(value: number, length: number): number[] {
  return new Array(length).fill(value);
}

export const DEFAULT_PARAMS: Record<string, Record<string, number>> = Object.fromEntries(
  strategies.map((s) => [s.id, Object.fromEntries(s.params.map((p) => [p.key, p.default]))]),
);
