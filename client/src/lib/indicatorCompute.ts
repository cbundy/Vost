/**
 * Indicator metadata shown in the sidebar, and defaults for new indicators.
 */
import type { Series } from '../types';
import { bollinger, ema, macd, rsi, sma, vwap, type MacdResult } from './indicators';
import type { Candle } from '../types';
import type { PineInputValue } from './pine/types';

export type IndicatorKind = 'sma' | 'ema' | 'bb' | 'vwap' | 'volume' | 'rsi' | 'macd' | 'pine';

export interface IndicatorParamSpec {
  key: string;
  label: string;
  type: 'int' | 'float';
  default: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface IndicatorMeta {
  kind: IndicatorKind;
  name: string;
  pane: 'main' | 'sub';
  params: IndicatorParamSpec[];
  defaultColor: string;
  description: string;
}

export const PALETTE = ['#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#eab308'];

export const INDICATOR_META: Record<IndicatorKind, IndicatorMeta> = {
  sma: {
    kind: 'sma',
    name: 'Simple moving average',
    pane: 'main',
    params: [{ key: 'length', label: 'Length', type: 'int', default: 50, min: 1, max: 1000 }],
    defaultColor: '#f59e0b',
    description: 'Average close over N bars',
  },
  ema: {
    kind: 'ema',
    name: 'Exponential moving average',
    pane: 'main',
    params: [{ key: 'length', label: 'Length', type: 'int', default: 200, min: 1, max: 2000 }],
    defaultColor: '#8b5cf6',
    description: 'Exponentially weighted moving average',
  },
  bb: {
    kind: 'bb',
    name: 'Bollinger Bands',
    pane: 'main',
    params: [
      { key: 'length', label: 'Length', type: 'int', default: 20, min: 2, max: 400 },
      { key: 'mult', label: 'Std dev', type: 'float', default: 2, min: 0.1, max: 6, step: 0.1 },
    ],
    defaultColor: '#06b6d4',
    description: 'Rolling mean ± N standard deviations',
  },
  vwap: {
    kind: 'vwap',
    name: 'VWAP',
    pane: 'main',
    params: [{ key: 'rolling', label: 'Rolling bars*', type: 'int', default: 20, min: 2, max: 2000 }],
    defaultColor: '#ec4899',
    description: 'Volume weighted average price (*rolling window for daily+ charts)',
  },
  volume: {
    kind: 'volume',
    name: 'Volume',
    pane: 'main',
    params: [],
    defaultColor: '#64748b',
    description: 'Bar volume histogram',
  },
  rsi: {
    kind: 'rsi',
    name: 'RSI',
    pane: 'sub',
    params: [{ key: 'length', label: 'Length', type: 'int', default: 14, min: 2, max: 200 }],
    defaultColor: '#eab308',
    description: 'Relative strength index (0-100)',
  },
  macd: {
    kind: 'macd',
    name: 'MACD',
    pane: 'sub',
    params: [
      { key: 'fast', label: 'Fast', type: 'int', default: 12, min: 1, max: 200 },
      { key: 'slow', label: 'Slow', type: 'int', default: 26, min: 2, max: 400 },
      { key: 'signal', label: 'Signal', type: 'int', default: 9, min: 1, max: 200 },
    ],
    defaultColor: '#3b82f6',
    description: 'Moving average convergence/divergence',
  },
  pine: {
    kind: 'pine',
    name: 'Pine indicator',
    pane: 'main',
    params: [],
    defaultColor: '#22d3ee',
    description: 'Run Pine Script source (indicator or strategy) on the chart',
  },
};

export const DEFAULT_PINE_SOURCE = `//@version=6
indicator("EMA cross", overlay=true)
fast = input.int(9, "Fast")
slow = input.int(21, "Slow")
plot(ta.ema(close, fast), "Fast", color.orange)
plot(ta.ema(close, slow), "Slow", color.blue)
`;

export interface IndicatorSpec {
  id: string;
  kind: IndicatorKind;
  params: Record<string, number>;
  color: string;
  visible: boolean;
  /** kind 'pine' only: the Pine Script source. */
  source?: string;
  /** kind 'pine' only: input overrides keyed by input title. */
  inputs?: Record<string, PineInputValue>;
}

let indicatorCounter = 0;

export function defaultIndicator(kind: IndicatorKind): IndicatorSpec {
  const meta = INDICATOR_META[kind];
  return {
    id: `ind_${Date.now().toString(36)}_${(indicatorCounter++).toString(36)}`,
    kind,
    params: Object.fromEntries(meta.params.map((p) => [p.key, p.default])),
    color: PALETTE[indicatorCounter % PALETTE.length],
    visible: true,
    ...(kind === 'pine' && { source: DEFAULT_PINE_SOURCE, inputs: {} }),
  };
}

export function indicatorTitle(spec: IndicatorSpec): string {
  const meta = INDICATOR_META[spec.kind];
  switch (spec.kind) {
    case 'sma':
      return `SMA ${spec.params.length}`;
    case 'ema':
      return `EMA ${spec.params.length}`;
    case 'bb':
      return `BB ${spec.params.length}, ${spec.params.mult}`;
    case 'vwap':
      return 'VWAP';
    case 'rsi':
      return `RSI ${spec.params.length}`;
    case 'macd':
      return `MACD ${spec.params.fast},${spec.params.slow},${spec.params.signal}`;
    case 'volume':
      return 'Volume';
    default:
      return meta.name;
  }
}

export interface ComputedSeries {
  key: string;
  title: string;
  kind: 'line' | 'histogram';
  color: string;
  lineWidth?: number;
  dashed?: boolean;
  pane: 'main' | 'sub' | 'volume';
  data: Array<{ time: number; value: number; color?: string }>;
  priceLines?: Array<{ value: number; color: string; dashed?: boolean }>;
}

function toPoints(candles: Candle[], values: Series): Array<{ time: number; value: number }> {
  const out: Array<{ time: number; value: number }> = [];
  for (let i = 0; i < candles.length; i++) {
    const v = values[i];
    if (v != null && Number.isFinite(v)) out.push({ time: candles[i].time, value: v });
  }
  return out;
}

/** Compute the drawable series for one indicator spec. */
export function computeIndicator(spec: IndicatorSpec, candles: Candle[]): ComputedSeries[] {
  const closes = candles.map((c) => c.close);
  const intraday = candles.length > 1 ? candles[1].time - candles[0].time < 86400 : false;
  switch (spec.kind) {
    case 'sma':
      return [line(spec, 'SMA', toPoints(candles, sma(closes, Math.max(1, spec.params.length))))];
    case 'ema':
      return [line(spec, 'EMA', toPoints(candles, ema(closes, Math.max(1, spec.params.length))))];
    case 'bb': {
      const { upper, middle, lower } = bollinger(closes, Math.max(2, spec.params.length), Math.max(0.1, spec.params.mult));
      return [
        line(spec, 'Upper', toPoints(candles, upper), { alpha: 0.55, width: 1 }),
        line(spec, 'Middle', toPoints(candles, middle), { dashed: true, width: 1 }),
        line(spec, 'Lower', toPoints(candles, lower), { alpha: 0.55, width: 1 }),
      ];
    }
    case 'vwap':
      return [
        line(spec, 'VWAP', toPoints(candles, vwap(candles, intraday, Math.max(2, spec.params.rolling ?? 20))), {
          dashed: true,
        }),
      ];
    case 'rsi': {
      const values = rsi(closes, Math.max(2, spec.params.length));
      return [
        {
          ...line(spec, 'RSI', toPoints(candles, values)),
          pane: 'sub',
          priceLines: [
            { value: 70, color: 'rgba(239,68,68,0.5)', dashed: true },
            { value: 30, color: 'rgba(34,197,94,0.5)', dashed: true },
          ],
        },
      ];
    }
    case 'macd': {
      const m: MacdResult = macd(closes, Math.max(1, spec.params.fast), Math.max(2, spec.params.slow), Math.max(1, spec.params.signal));
      const hist = toPoints(candles, m.histogram).map((p) => ({
        ...p,
        color: p.value >= 0 ? 'rgba(34,197,94,0.55)' : 'rgba(239,68,68,0.55)',
      }));
      return [
        {
          key: 'macd_hist',
          title: 'Histogram',
          kind: 'histogram',
          color: spec.color,
          pane: 'sub',
          data: hist,
        },
        { ...line(spec, 'MACD', toPoints(candles, m.macd)), pane: 'sub', color: spec.color },
        { ...line(spec, 'Signal', toPoints(candles, m.signal), { width: 1 }), pane: 'sub', color: '#f97316' },
      ];
    }
    case 'volume': {
      const data = candles
        .filter((c) => Number.isFinite(c.volume))
        .map((c) => ({
          time: c.time,
          value: Math.max(0, c.volume),
          color: c.close >= c.open ? 'rgba(34,197,94,0.35)' : 'rgba(239,68,68,0.35)',
        }));
      return [
        {
          key: 'volume',
          title: 'Volume',
          kind: 'histogram',
          color: spec.color,
          pane: 'volume',
          data,
        },
      ];
    }
    default:
      return [];
  }
}

function line(
  spec: IndicatorSpec,
  title: string,
  data: Array<{ time: number; value: number }>,
  opts: { alpha?: number; width?: number; dashed?: boolean } = {},
): ComputedSeries {
  return {
    key: `${spec.kind}_${title}`,
    title,
    kind: 'line',
    color: opts.alpha != null ? hexToRgba(spec.color, opts.alpha) : spec.color,
    lineWidth: opts.width ?? 2,
    dashed: opts.dashed,
    pane: INDICATOR_META[spec.kind].pane,
    data,
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}
