/**
 * The model's inputs: indicator readings generated per strategy family from a coarse grid of that family's
 * settings, never picked to fit one strategy. Each feature knows its family and settings so the model can point
 * the search at them.
 */
import { atr, bollinger, ema, highest, lowest, macd, rsi, sma } from '../../lib/indicators';
import type { Candle, Series } from '../../types';

export interface Feature {
  /** Stable key; a saved model names its features by it. */
  id: string;
  label: string;
  /** A strategy family id, or null for readings that belong to none. */
  family: string | null;
  /** Settings, keyed as the family's ParamSpec keys. */
  params: Record<string, number>;
}

interface FeatureDef {
  feature: Feature;
  /** Whether the value is a ratio shown as a percent. */
  percent: boolean;
  compute(candles: Candle[], closes: number[]): Series;
}

const FAST = [5, 8, 10, 13, 20];
const SLOW = [21, 30, 34, 50, 100, 200];
const MACD_SETTINGS: Array<[number, number, number]> = [
  [12, 26, 9],
  [8, 21, 5],
];
const RSI_LENGTHS = [5, 14, 21];
const BOLLINGER_SETTINGS: Array<[number, number]> = [
  [20, 2],
  [20, 2.5],
];
const DONCHIAN_ENTRIES = [10, 20, 55];
const RETURN_LAGS = [1, 5, 20];

const ratio = (a: number | null, b: number | null): number | null => (a == null || b == null || b === 0 ? null : a / b);

function build(): FeatureDef[] {
  const defs: FeatureDef[] = [];
  for (const [family, name, average] of [
    ['sma_cross', 'SMA', sma],
    ['ema_cross', 'EMA', ema],
  ] as const) {
    for (const fast of FAST) {
      for (const slow of SLOW) {
        defs.push({
          feature: { id: `${family}_${fast}_${slow}`, label: `${name} ${fast} / ${name} ${slow} distance`, family, params: { fast, slow } },
          percent: true,
          compute: (_, closes) => {
            const f = average(closes, fast);
            const s = average(closes, slow);
            return closes.map((_c, i) => {
              const r = ratio(f[i], s[i]);
              return r == null ? null : r - 1;
            });
          },
        });
      }
    }
  }
  for (const [fast, slow, signal] of MACD_SETTINGS) {
    defs.push({
      feature: { id: `macd_cross_${fast}_${slow}_${signal}`, label: `MACD histogram ${fast}/${slow}/${signal} / close`, family: 'macd_cross', params: { fast, slow, signal } },
      percent: true,
      compute: (_, closes) => {
        const h = macd(closes, fast, slow, signal).histogram;
        return closes.map((c, i) => ratio(h[i], c));
      },
    });
  }
  for (const length of RSI_LENGTHS) {
    defs.push({
      feature: { id: `rsi_reversion_${length}`, label: `RSI ${length}`, family: 'rsi_reversion', params: { length } },
      percent: false,
      compute: (_, closes) => rsi(closes, length),
    });
  }
  for (const [length, mult] of BOLLINGER_SETTINGS) {
    defs.push({
      feature: { id: `bollinger_${length}_${mult}`, label: `Bollinger %B ${length}, ${mult}`, family: 'bollinger', params: { length, mult } },
      percent: false,
      compute: (_, closes) => {
        const { upper, lower } = bollinger(closes, length, mult);
        return closes.map((c, i) => {
          const u = upper[i];
          const l = lower[i];
          return u == null || l == null || u === l ? null : (c - l) / (u - l);
        });
      },
    });
  }
  for (const entry of DONCHIAN_ENTRIES) {
    defs.push({
      feature: { id: `donchian_${entry}`, label: `Donchian ${entry} position`, family: 'donchian', params: { entry } },
      percent: false,
      compute: (candles, closes) => {
        const hi = highest(candles.map((c) => c.high), entry);
        const lo = lowest(candles.map((c) => c.low), entry);
        return closes.map((c, i) => {
          const h = hi[i];
          const l = lo[i];
          return h == null || l == null || h === l ? null : (c - l) / (h - l);
        });
      },
    });
  }
  defs.push({
    feature: { id: 'atr_14', label: 'ATR 14 / close', family: null, params: {} },
    percent: true,
    compute: (candles, closes) => {
      const a = atr(candles, 14);
      return closes.map((c, i) => ratio(a[i], c));
    },
  });
  for (const lag of RETURN_LAGS) {
    defs.push({
      feature: { id: `return_${lag}`, label: `${lag} bar return`, family: null, params: {} },
      percent: true,
      compute: (_, closes) => closes.map((c, i) => (i < lag || closes[i - lag] === 0 ? null : c / closes[i - lag] - 1)),
    });
  }
  return defs;
}

const DEFS = build();
const BY_ID = new Map(DEFS.map((d) => [d.feature.id, d]));

/** Every feature the model can use, in a fixed order. */
export const FEATURES: readonly Feature[] = DEFS.map((d) => d.feature);

export function isKnownFeature(f: Feature): boolean {
  const known = BY_ID.get(f.id)?.feature;
  return known != null && known.label === f.label && known.family === f.family && JSON.stringify(known.params) === JSON.stringify(f.params);
}

/** One feature's value per bar; NaN where it is not defined yet (warm-up). */
export function featureColumn(id: string, candles: Candle[]): Float64Array {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`Unknown feature "${id}"`);
  const closes = candles.map((c) => c.close);
  const series = def.compute(candles, closes);
  const out = new Float64Array(candles.length);
  for (let i = 0; i < out.length; i++) {
    const v = series[i];
    out[i] = v != null && Number.isFinite(v) ? v : NaN;
  }
  return out;
}

/** A threshold of a feature as people read it (a ratio as a percent). */
export function formatValue(id: string, v: number): string {
  if (BY_ID.get(id)?.percent) return `${Number((v * 100).toFixed(2))}%`;
  return String(Number(v.toFixed(2)));
}
