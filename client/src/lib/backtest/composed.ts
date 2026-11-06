/**
 * The "Composed" strategy's compose loop: an entry family gives the entries, and up to four filters
 * (trend, volume, volatility, trend strength) can veto a fresh entry. Every filter reads only bar i's
 * values, so there is no look-ahead. The exit is always the entry family's own.
 */
import type { Candle } from '../../types';
import { adx, atr, ema, sma, volumeSma } from '../indicators';
import type { BacktestFilters, Signal } from './types';

export const COMPOSED_DEFAULTS = {
  trendFilter: 0,
  trendLen: 100,
  volumeFilter: 0,
  volumeLen: 20,
  volumeMult: 1,
  atrFilter: 0,
  atrLen: 14,
  atrMinPct: 0.5,
  atrMaxPct: 5,
  adxFilter: 0,
  adxLen: 14,
  adxMin: 20,
} as const;

type FilterKey = BacktestFilters['blocked'][number]['key'];

interface Filter {
  key: FilterKey;
  /** Whether the bar passes for a side; null while the filter has no value yet. */
  check(i: number, side: 1 | -1): boolean | null;
}

function pick(p: Record<string, number>, key: keyof typeof COMPOSED_DEFAULTS): number {
  const n = Number(p[key]);
  return Number.isFinite(n) ? n : COMPOSED_DEFAULTS[key];
}

function len(p: Record<string, number>, key: keyof typeof COMPOSED_DEFAULTS): number {
  const n = Math.round(pick(p, key));
  return n > 0 ? n : COMPOSED_DEFAULTS[key];
}

function enabledFilters(candles: Candle[], p: Record<string, number>): Filter[] {
  const filters: Filter[] = [];
  const mode = Math.round(pick(p, 'trendFilter'));
  if (mode === 1 || mode === 2) {
    const closes = candles.map((c) => c.close);
    const ma = mode === 1 ? sma(closes, len(p, 'trendLen')) : ema(closes, len(p, 'trendLen'));
    filters.push({
      key: 'trend',
      check: (i, side) => {
        const v = ma[i];
        if (v == null) return null;
        return side === 1 ? closes[i] > v : closes[i] < v;
      },
    });
  }
  if (Math.round(pick(p, 'volumeFilter')) === 1) {
    const avg = volumeSma(candles, len(p, 'volumeLen'));
    const mult = pick(p, 'volumeMult');
    filters.push({
      key: 'volume',
      check: (i) => {
        const a = avg[i];
        if (a == null) return null;
        return a > 0 && candles[i].volume >= mult * a;
      },
    });
  }
  if (Math.round(pick(p, 'atrFilter')) === 1) {
    const a = atr(candles, len(p, 'atrLen'));
    const lo = pick(p, 'atrMinPct');
    const hi = pick(p, 'atrMaxPct');
    filters.push({
      key: 'volatility',
      check: (i) => {
        const v = a[i];
        if (v == null) return null;
        const close = candles[i].close;
        if (!(close > 0)) return false;
        const pct = (v / close) * 100;
        return pct >= lo && pct <= hi;
      },
    });
  }
  if (Math.round(pick(p, 'adxFilter')) === 1) {
    const a = adx(candles, len(p, 'adxLen'));
    const min = pick(p, 'adxMin');
    filters.push({
      key: 'strength',
      check: (i) => {
        const v = a[i];
        return v == null ? null : v >= min;
      },
    });
  }
  return filters;
}

/** Compose the entry family's exposure with the enabled filters. `filters` lists only enabled filters. */
export function composeSignals(
  candles: Candle[],
  entry: Signal[],
  params: Record<string, number>,
): { signals: Signal[]; filters: BacktestFilters } {
  const active = enabledFilters(candles, params);
  const blocked = active.map((f) => ({
    key: f.key,
    label: f.key as string,
    blocked: 0,
  }));
  const out: Signal[] = new Array(candles.length).fill(null);
  let signals = 0;
  let taken = 0;
  let pos: Signal = 0;
  for (let i = 0; i < candles.length; i++) {
    const e = entry[i];
    if (e == null) continue;
    const results = active.map((f) => f.check(i, e === -1 ? -1 : 1));
    if (results.some((r) => r === null)) continue; // an enabled filter is still warming up
    // The exit is the family's own: leave when its exposure leaves our side.
    if (pos !== 0 && e !== pos) pos = 0;
    const prev = i > 0 ? entry[i - 1] : null;
    if (pos === 0 && e !== 0 && prev !== e) {
      signals++;
      let ok = true;
      results.forEach((r, k) => {
        if (!r) {
          ok = false;
          blocked[k].blocked++;
        }
      });
      if (ok) {
        taken++;
        pos = e;
      }
    }
    out[i] = pos;
  }
  return { signals: out, filters: { signals, taken, blocked } };
}
