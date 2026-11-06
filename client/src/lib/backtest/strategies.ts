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
import { COMPOSED_DEFAULTS, composeSignals } from './composed';
import { compileCustomStrategy, DEFAULT_CUSTOM_CODE } from './custom';
import { ENTRY_RULE_PINE, type PineRoleContext } from './pineRole';
import type { BacktestFilters, Signal } from './types';

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
  /** Shown only while the setting `key` holds one of `values` (Composed strategy). */
  visibleWhen?: { key: string; values: number[] };
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
  /** `ctx` holds the computed TradingView indicator values (Composed only). */
  build(candles: Candle[], params: Record<string, number>, ctx?: PineRoleContext): Signal[];
  /** Extra result data from the same pass that builds the signals (Composed: blocked entry counts). */
  report?(candles: Candle[], params: Record<string, number>, ctx?: PineRoleContext): BacktestFilters;
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

/* Composed: one family gives the entries, up to four filters can veto them. */

const ENTRY_RULES: Array<{
  value: number;
  label: string;
  id: string;
  keys: string[];
}> = [
  { value: 1, label: 'SMA crossover', id: 'sma_cross', keys: ['fast', 'slow'] },
  { value: 2, label: 'EMA crossover', id: 'ema_cross', keys: ['fast', 'slow'] },
  {
    value: 3,
    label: 'MACD',
    id: 'macd_cross',
    keys: ['fast', 'slow', 'signal'],
  },
  {
    value: 4,
    label: 'RSI mean reversion',
    id: 'rsi_reversion',
    keys: ['length', 'oversold', 'overbought'],
  },
  {
    value: 5,
    label: 'Bollinger Bands',
    id: 'bollinger',
    keys: ['length', 'mult', 'mode'],
  },
  {
    value: 6,
    label: 'Donchian breakout',
    id: 'donchian',
    keys: ['entry', 'exit'],
  },
  // Its signals come from the entry role's indicator, not from a strategy.
  { value: ENTRY_RULE_PINE, label: 'TradingView indicator', id: '', keys: [] },
];

/** The entry rule's own setting keys in Composed (without direction). */
export function composedEntryKeys(rule: number): string[] {
  return (ENTRY_RULES.find((r) => r.value === Math.round(rule)) ?? ENTRY_RULES[1]).keys;
}

const entryWhen = (...values: number[]) => ({ key: 'entryRule', values });
const onWhen = (key: string) => ({ key, values: [1] });
const OFF_ON = [
  { value: 0, label: 'Off' },
  { value: 1, label: 'On' },
];

function composedRun(candles: Candle[], p: Record<string, number>, ctx?: PineRoleContext) {
  const rule = ENTRY_RULES.find((r) => r.value === Math.round(Number(p.entryRule))) ?? ENTRY_RULES[1];
  if (rule.value === ENTRY_RULE_PINE) {
    if (!ctx?.entry) throw new Error('Pick a TradingView indicator for the entry rule');
    const entry = normalizeSignals(ctx.entry.signals(direction(p.direction)), candles.length);
    return composeSignals(candles, entry, { ...COMPOSED_DEFAULTS, ...p }, ctx);
  }
  const family = getStrategy(rule.id);
  const own: Record<string, number> = { direction: p.direction };
  for (const k of rule.keys) own[k] = p[k];
  // Settings the caller left out take the Composed defaults.
  const defaults = Object.fromEntries(composedDef.params.map((s) => [s.key, s.default]));
  for (const k of Object.keys(own)) if (!Number.isFinite(Number(own[k]))) own[k] = defaults[k];
  const entry = normalizeSignals(family.build(candles, own), candles.length);
  const full = { ...COMPOSED_DEFAULTS, ...p };
  return composeSignals(candles, entry, full, ctx);
}

const composedDef: StrategyDef = {
  id: 'composed',
  name: 'Composed (entry + filters)',
  description:
    "Pick an entry rule, then switch on filters (trend, volume, volatility, trend strength) that veto entries. Exits are the entry rule's own.",
  params: [
    {
      key: 'entryRule',
      label: 'Entry rule',
      type: 'select',
      default: 2,
      options: ENTRY_RULES.map((r) => ({ value: r.value, label: r.label })),
    },
    {
      key: 'direction',
      label: 'Direction',
      type: 'select',
      default: 1,
      options: DIRECTION_OPTIONS,
    },
    {
      key: 'fast',
      label: 'Fast period',
      type: 'int',
      default: 12,
      min: 1,
      max: 500,
      visibleWhen: entryWhen(1, 2, 3),
    },
    {
      key: 'slow',
      label: 'Slow period',
      type: 'int',
      default: 26,
      min: 2,
      max: 1000,
      visibleWhen: entryWhen(1, 2, 3),
    },
    {
      key: 'signal',
      label: 'Signal EMA',
      type: 'int',
      default: 9,
      min: 1,
      max: 200,
      visibleWhen: entryWhen(3),
    },
    {
      key: 'length',
      label: 'Length',
      type: 'int',
      default: 20,
      min: 2,
      max: 400,
      visibleWhen: entryWhen(4, 5),
    },
    {
      key: 'oversold',
      label: 'Oversold',
      type: 'float',
      default: 30,
      min: 1,
      max: 49,
      step: 1,
      visibleWhen: entryWhen(4),
    },
    {
      key: 'overbought',
      label: 'Overbought',
      type: 'float',
      default: 70,
      min: 51,
      max: 99,
      step: 1,
      visibleWhen: entryWhen(4),
    },
    {
      key: 'mult',
      label: 'Std dev mult',
      type: 'float',
      default: 2,
      min: 0.1,
      max: 6,
      step: 0.1,
      visibleWhen: entryWhen(5),
    },
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: 'Breakout' },
        { value: 1, label: 'Mean reversion' },
      ],
      visibleWhen: entryWhen(5),
    },
    {
      key: 'entry',
      label: 'Entry period',
      type: 'int',
      default: 20,
      min: 2,
      max: 400,
      visibleWhen: entryWhen(6),
    },
    {
      key: 'exit',
      label: 'Exit period',
      type: 'int',
      default: 10,
      min: 1,
      max: 400,
      visibleWhen: entryWhen(6),
    },
    {
      key: 'trendFilter',
      label: 'Trend filter',
      type: 'select',
      default: 0,
      options: [
        { value: 0, label: 'Off' },
        { value: 1, label: 'Price vs SMA' },
        { value: 2, label: 'Price vs EMA' },
      ],
      hint: 'Long entries need the close above the average, short entries below it.',
    },
    {
      key: 'trendLen',
      label: 'Trend average length',
      type: 'int',
      default: COMPOSED_DEFAULTS.trendLen,
      min: 2,
      max: 1000,
      visibleWhen: { key: 'trendFilter', values: [1, 2] },
    },
    {
      key: 'trendTf',
      label: 'Trend timeframe',
      type: 'select',
      default: COMPOSED_DEFAULTS.trendTf,
      options: [
        { value: 1, label: 'Same as the chart' },
        { value: 2, label: '2x the chart' },
        { value: 3, label: '3x the chart' },
        { value: 4, label: '4x the chart' },
        { value: 6, label: '6x the chart' },
        { value: 8, label: '8x the chart' },
        { value: 12, label: '12x the chart' },
        { value: 24, label: '24x the chart' },
      ],
      hint: 'Read the average and the close on a longer timeframe. Built from the loaded bars; a bar counts only once it has closed. If the multiple is not a valid timeframe, or the bars are a week or longer, the loaded bars are used.',
      visibleWhen: { key: 'trendFilter', values: [1, 2] },
    },
    {
      key: 'volumeFilter',
      label: 'Volume filter',
      type: 'select',
      default: 0,
      options: OFF_ON,
      hint: 'The entry bar needs volume of at least the multiple of its recent average.',
    },
    {
      key: 'volumeLen',
      label: 'Volume average length',
      type: 'int',
      default: COMPOSED_DEFAULTS.volumeLen,
      min: 1,
      max: 1000,
      visibleWhen: onWhen('volumeFilter'),
    },
    {
      key: 'volumeMult',
      label: 'Volume multiple',
      type: 'float',
      default: COMPOSED_DEFAULTS.volumeMult,
      min: 0,
      max: 20,
      step: 0.1,
      visibleWhen: onWhen('volumeFilter'),
    },
    {
      key: 'atrFilter',
      label: 'Volatility filter',
      type: 'select',
      default: 0,
      options: OFF_ON,
      hint: 'ATR as a percent of the close must be within the band.',
    },
    {
      key: 'atrLen',
      label: 'ATR length',
      type: 'int',
      default: COMPOSED_DEFAULTS.atrLen,
      min: 1,
      max: 500,
      visibleWhen: onWhen('atrFilter'),
    },
    {
      key: 'atrMinPct',
      label: 'ATR min (% of close)',
      type: 'float',
      default: COMPOSED_DEFAULTS.atrMinPct,
      min: 0,
      max: 100,
      step: 0.1,
      visibleWhen: onWhen('atrFilter'),
    },
    {
      key: 'atrMaxPct',
      label: 'ATR max (% of close)',
      type: 'float',
      default: COMPOSED_DEFAULTS.atrMaxPct,
      min: 0,
      max: 100,
      step: 0.1,
      visibleWhen: onWhen('atrFilter'),
    },
    {
      key: 'atrTf',
      label: 'Volatility timeframe',
      type: 'select',
      default: COMPOSED_DEFAULTS.atrTf,
      options: [
        { value: 1, label: 'Same as the chart' },
        { value: 2, label: '2x the chart' },
        { value: 3, label: '3x the chart' },
        { value: 4, label: '4x the chart' },
        { value: 6, label: '6x the chart' },
        { value: 8, label: '8x the chart' },
        { value: 12, label: '12x the chart' },
        { value: 24, label: '24x the chart' },
      ],
      hint: 'Measure ATR on a longer timeframe. Built from the loaded bars; a bar counts only once it has closed. If the multiple is not a valid timeframe, or the bars are a week or longer, the loaded bars are used.',
      visibleWhen: onWhen('atrFilter'),
    },
    {
      key: 'adxFilter',
      label: 'Trend-strength filter',
      type: 'select',
      default: 0,
      options: OFF_ON,
      hint: 'ADX must be at least the minimum.',
    },
    {
      key: 'adxLen',
      label: 'ADX length',
      type: 'int',
      default: COMPOSED_DEFAULTS.adxLen,
      min: 1,
      max: 200,
      visibleWhen: onWhen('adxFilter'),
    },
    {
      key: 'adxMin',
      label: 'ADX minimum',
      type: 'float',
      default: COMPOSED_DEFAULTS.adxMin,
      min: 0,
      max: 100,
      step: 1,
      visibleWhen: onWhen('adxFilter'),
    },
  ],
  build(candles, p, ctx) {
    return composedRun(candles, p, ctx).signals;
  },
  report(candles, p, ctx) {
    return composedRun(candles, p, ctx).filters;
  },
};

/** The settings to show for the current values: a setting with `visibleWhen` shows only while its switch matches. */
export function visibleParams(strategy: Pick<StrategyDef, 'params'>, params: Record<string, number>): ParamSpec[] {
  return strategy.params.filter((p) => {
    if (!p.visibleWhen) return true;
    const gate = strategy.params.find((x) => x.key === p.visibleWhen!.key);
    const v = params[p.visibleWhen.key] ?? gate?.default;
    return v != null && p.visibleWhen.values.includes(Math.round(Number(v)));
  });
}
const pullback: StrategyDef = {
  id: 'pullback',
  name: 'Pullback in trend',
  description: 'Buy a dip inside an uptrend: close above the trend EMA and RSI crossing back up through the dip level; exit above the target or when the trend breaks (mirrored for shorts).',
  params: [
    { key: 'trend', label: 'Trend EMA length', type: 'int', default: 200, min: 2, max: 1000 },
    { key: 'length', label: 'RSI length', type: 'int', default: 14, min: 2, max: 200 },
    { key: 'dip', label: 'Dip level', type: 'float', default: 40, min: 1, max: 49, step: 1 },
    { key: 'target', label: 'Target level', type: 'float', default: 70, min: 51, max: 99, step: 1 },
    { key: 'direction', label: 'Direction', type: 'select', default: 1, options: DIRECTION_OPTIONS },
  ],
  build(candles, p) {
    const closes = candles.map((c) => c.close);
    const trend = ema(closes, int(p.trend, 200));
    const r = rsi(closes, int(p.length, 14));
    const dip = num(p.dip, 40);
    const target = num(p.target, 70);
    const dir = direction(p.direction);
    const dipLine = constSeries(dip, candles.length);
    const mirrorDipLine = constSeries(100 - dip, candles.length);
    const out: Signal[] = new Array(candles.length).fill(null);
    let pos: -1 | 0 | 1 = 0;
    for (let i = 0; i < candles.length; i++) {
      const v = r[i];
      const t = trend[i];
      if (v == null || t == null) continue;
      const c = closes[i];
      if (dir !== 2) {
        if (pos === 0 && c > t && crossover(r, dipLine, i)) pos = 1;
        else if (pos === 1 && (v > target || c < t)) pos = 0;
      }
      if (dir !== 1) {
        if (pos === 0 && c < t && crossunder(r, mirrorDipLine, i)) pos = -1;
        else if (pos === -1 && (v < 100 - target || c > t)) pos = 0;
      }
      out[i] = pos;
    }
    return out;
  },
};

const reversal: StrategyDef = {
  id: 'reversal',
  name: 'Reversal',
  description: 'Buy when price closes back inside the lower Bollinger band after closing below it; exit at the middle band (mirrored for shorts with the upper band).',
  params: [
    { key: 'length', label: 'Length', type: 'int', default: 20, min: 2, max: 400 },
    { key: 'mult', label: 'Std dev mult', type: 'float', default: 2, min: 0.1, max: 6, step: 0.1 },
    { key: 'direction', label: 'Direction', type: 'select', default: 1, options: DIRECTION_OPTIONS },
  ],
  build(candles, p) {
    const closes = candles.map((c) => c.close);
    const { upper, middle, lower } = bollinger(closes, int(p.length, 20), num(p.mult, 2));
    const dir = direction(p.direction);
    const out: Signal[] = new Array(candles.length).fill(null);
    let pos: -1 | 0 | 1 = 0;
    for (let i = 0; i < candles.length; i++) {
      const u = upper[i];
      const m = middle[i];
      const l = lower[i];
      if (u == null || m == null || l == null) continue;
      const c = closes[i];
      const pu = i > 0 ? upper[i - 1] : null;
      const pl = i > 0 ? lower[i - 1] : null;
      const pc = i > 0 ? closes[i - 1] : 0;
      if (dir !== 2) {
        if (pos === 0 && pl != null && pc < pl && c > l) pos = 1;
        else if (pos === 1 && c > m) pos = 0;
      }
      if (dir !== 1) {
        if (pos === 0 && pu != null && pc > pu && c < u) pos = -1;
        else if (pos === -1 && c < m) pos = 0;
      }
      out[i] = pos;
    }
    return out;
  },
};

const momentumBreakout: StrategyDef = {
  id: 'momentum_breakout',
  name: 'Momentum breakout',
  description: 'Buy a new N-bar high only when volume is well above its recent average; exit on a new M-bar low (mirrored for shorts).',
  params: [
    { key: 'entry', label: 'Entry period', type: 'int', default: 20, min: 2, max: 400 },
    { key: 'exit', label: 'Exit period', type: 'int', default: 10, min: 1, max: 400 },
    { key: 'volLen', label: 'Volume average length', type: 'int', default: 20, min: 2, max: 400 },
    { key: 'volMult', label: 'Volume multiple', type: 'float', default: 1.5, min: 1, max: 10, step: 0.1 },
    { key: 'direction', label: 'Direction', type: 'select', default: 1, options: DIRECTION_OPTIONS },
  ],
  build(candles, p) {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);
    const volumes = candles.map((c) => c.volume);
    const entry = int(p.entry, 20);
    const exit = int(p.exit, 10);
    const hh = highest(highs, entry);
    const ll = lowest(lows, exit);
    const lEntry = lowest(lows, entry);
    const hhExit = highest(highs, exit);
    const avgVol = sma(volumes, int(p.volLen, 20));
    const volMult = num(p.volMult, 1.5);
    const dir = direction(p.direction);
    const out: Signal[] = new Array(candles.length).fill(null);
    let pos: -1 | 0 | 1 = 0;
    for (let i = 1; i < candles.length; i++) {
      const upLevel = hh[i - 1];
      const downLevel = ll[i - 1];
      const downBreak = lEntry[i - 1];
      const upBreak = hhExit[i - 1];
      const av = avgVol[i - 1];
      if (upLevel == null || downLevel == null || downBreak == null || upBreak == null || av == null) continue;
      const c = closes[i];
      const loud = volumes[i] >= volMult * av;
      if (dir !== 2) {
        if (pos === 0 && c > upLevel && loud) pos = 1;
        else if (pos === 1 && c < downLevel) pos = 0;
      }
      if (dir !== 1) {
        if (pos === 0 && c < downBreak && loud) pos = -1;
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
  composedDef,
  pullback,
  reversal,
  momentumBreakout,
  buyHold,
  customStrategy,
  pineStrategy,
];

export type StrategyStyle = 'trend' | 'continuation' | 'mean_reversion' | 'reversal' | 'breakout' | 'momentum';

/** The trading style of each searchable strategy, primary style first. The one place styles are kept. */
export const STRATEGY_STYLES: Record<string, readonly StrategyStyle[]> = {
  sma_cross: ['trend'],
  ema_cross: ['trend'],
  macd_cross: ['trend'],
  rsi_reversion: ['mean_reversion'],
  bollinger: ['breakout', 'mean_reversion'],
  donchian: ['breakout'],
  // The search keeps the entry rule at its default (EMA crossover), so Composed searches as a trend strategy.
  composed: ['trend'],
  pullback: ['continuation', 'trend'],
  reversal: ['reversal'],
  momentum_breakout: ['momentum', 'breakout'],
};

export function stylesOf(id: string): readonly StrategyStyle[] {
  return STRATEGY_STYLES[id] ?? [];
}

export function getStrategy(id: string): StrategyDef {
  return strategies.find((s) => s.id === id) ?? strategies[0];
}

/** Build the signal array for a strategy + config (throws on custom-code errors). */
export function buildSignals(candles: Candle[], strategyId: string, params: Record<string, number>, customCode?: string, ctx?: PineRoleContext): Signal[] {
  const strategy = getStrategy(strategyId);
  if (strategy.custom) {
    const merged = { ...params, __code: customCode ?? DEFAULT_CUSTOM_CODE } as unknown as Record<string, number>;
    const raw = compileCustomStrategy(customCode ?? DEFAULT_CUSTOM_CODE)(candles, merged);
    return normalizeSignals(raw, candles.length);
  }
  const raw = strategy.build(candles, params, ctx);
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
