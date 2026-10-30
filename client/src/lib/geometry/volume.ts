/** Pure maths of the volume-based tools: anchored VWAP with deviation bands and the volume profile. No chart imports. */
import type { OhlcBar } from '../drawingGeometry';
import { sourceValue } from './channels';

/** A bar's volume: zero when it is missing, not finite or negative. */
export function barVolume(bar: OhlcBar): number {
  const v = bar.volume;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/* ------------------------------- memoisation ------------------------------- */

const MAX_PER_ARRAY = 24;
const caches = new WeakMap<object, Map<string, unknown>>();

/**
 * Wraps a pure function of (candles, ...inputs): the result of the same candle array (by identity) and the same
 * inputs is the same object, so a repaint with nothing changed does not compute again. A new candle array (a live
 * bar, a timeframe change) starts clean, and the old results go with the old array.
 */
export function memoOnCandles<A extends unknown[], R>(name: string, fn: (candles: readonly OhlcBar[], ...args: A) => R): (candles: readonly OhlcBar[], ...args: A) => R {
  return (candles, ...args) => {
    let m = caches.get(candles);
    if (!m) caches.set(candles, (m = new Map()));
    const key = `${name}:${JSON.stringify(args)}`;
    if (m.has(key)) return m.get(key) as R;
    const r = fn(candles, ...args);
    if (m.size >= MAX_PER_ARRAY) m.delete(m.keys().next().value as string);
    m.set(key, r);
    return r;
  };
}

/* ---------------------------------- VWAP ---------------------------------- */

export type VwapBand = { multiplier: number; upper: (number | null)[]; lower: (number | null)[] };

/** An anchored VWAP: values are per bar from `first` (the anchor bar's index) to the last bar; null before any volume. */
export type VwapResult = {
  first: number;
  vwap: (number | null)[];
  /** Volume-weighted standard deviation of the source around the VWAP. */
  sigma: (number | null)[];
  bands: VwapBand[];
};

/** The index of the bar holding a time: the last bar at or before it; -1 before the first bar or past the last bar's slot. */
export function barIndexAt(candles: readonly OhlcBar[], time: number): number {
  const n = candles.length;
  if (n === 0 || !Number.isFinite(time) || time < candles[0].time) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (candles[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  if (lo === n - 1 && time > candles[n - 1].time) {
    const step = n > 1 ? candles[n - 1].time - candles[n - 2].time : 0;
    if (!(time < candles[n - 1].time + step)) return -1;
  }
  return lo;
}

/**
 * VWAP = sum(src x vol) / sum(vol) from the anchor bar on, with bands at VWAP +/- m x sigma,
 * sigma = sqrt(sum(vol x src^2) / sum(vol) - VWAP^2). Null (no `first`) when the anchor is outside the loaded bars.
 * Bars before the first non-zero cumulative volume have no value; a zero-volume bar after that keeps the VWAP.
 */
export function anchoredVwapRaw(candles: readonly OhlcBar[], time: number, source: string, multipliers: readonly number[]): VwapResult | null {
  const first = barIndexAt(candles, time);
  if (first < 0) return null;
  const vwap: (number | null)[] = [];
  const sigma: (number | null)[] = [];
  let cv = 0;
  let cpv = 0;
  let cpv2 = 0;
  for (let i = first; i < candles.length; i++) {
    const v = barVolume(candles[i]);
    const s = sourceValue(candles[i], source);
    if (Number.isFinite(s)) {
      cv += v;
      cpv += v * s;
      cpv2 += v * s * s;
    }
    if (cv > 0) {
      const m = cpv / cv;
      vwap.push(m);
      sigma.push(Math.sqrt(Math.max(0, cpv2 / cv - m * m)));
    } else {
      vwap.push(null);
      sigma.push(null);
    }
  }
  const bands = multipliers.map((multiplier) => ({
    multiplier,
    upper: vwap.map((m, i) => (m === null ? null : m + multiplier * (sigma[i] as number))),
    lower: vwap.map((m, i) => (m === null ? null : m - multiplier * (sigma[i] as number))),
  }));
  return { first, vwap, sigma, bands };
}

export const anchoredVwap = memoOnCandles('vwap', anchoredVwapRaw);

/* ----------------------------- volume profile ----------------------------- */

export type ProfileOpts = {
  /** Number of rows (the default layout), or ticks per row when `ticksPerRow` is set. */
  rows?: number;
  ticksPerRow?: number;
  /** Percent of the total volume the value area holds (1 to 100). */
  valueAreaPct: number;
};

export type ProfileRow = { low: number; high: number; up: number; down: number; total: number };

export type VolumeProfile = {
  low: number;
  high: number;
  rows: ProfileRow[];
  /** Largest row total. */
  maxTotal: number;
  total: number;
  /** Index of the point of control row (most volume, the lower on a tie); -1 with no volume. */
  poc: number;
  /** Value area rows (inclusive) and prices; -1 and null with no volume. */
  vaLowRow: number;
  vaHighRow: number;
  vaLow: number | null;
  vaHigh: number | null;
};

const MAX_ROWS = 1000;

/** The price tick of the bars: the coarsest power of ten (up to 8 decimals) every sampled price is a whole multiple of. */
export function inferTick(candles: readonly OhlcBar[]): number {
  for (let d = 0; d <= 8; d++) {
    const k = 10 ** d;
    let ok = true;
    for (let i = 0; i < Math.min(candles.length, 200) && ok; i++) {
      for (const v of [candles[i].open, candles[i].high, candles[i].low, candles[i].close]) {
        const x = v * k;
        if (!Number.isFinite(x) || Math.abs(x - Math.round(x)) > 1e-6 * Math.max(1, Math.abs(x))) {
          ok = false;
          break;
        }
      }
    }
    if (ok) return 1 / k;
  }
  return 1e-8;
}

/** The profile of the bars whose time lies between two times (either order, inclusive); null with no bars there. */
export function volumeProfileRaw(candles: readonly OhlcBar[], t0: number, t1: number, opts: ProfileOpts): VolumeProfile | null {
  const lo = Math.min(t0, t1);
  const hi = Math.max(t0, t1);
  const bars = candles.filter((c) => c.time >= lo && c.time <= hi && Number.isFinite(c.high) && Number.isFinite(c.low));
  if (bars.length === 0) return null;
  let low = Infinity;
  let high = -Infinity;
  for (const b of bars) {
    low = Math.min(low, b.low, b.high);
    high = Math.max(high, b.low, b.high);
  }
  const range = high - low;
  let n: number;
  if (opts.ticksPerRow !== undefined) {
    const size = Math.max(1, opts.ticksPerRow) * inferTick(bars);
    n = range > 0 ? Math.ceil(range / size - 1e-9) : 1;
  } else {
    n = Math.round(opts.rows ?? 24);
  }
  n = Math.max(1, Math.min(MAX_ROWS, n));
  const size = range / n;
  const rows: ProfileRow[] = Array.from({ length: n }, (_, i) => ({ low: low + i * size, high: i === n - 1 ? high : low + (i + 1) * size, up: 0, down: 0, total: 0 }));
  const rowOf = (price: number) => (size > 0 ? Math.max(0, Math.min(n - 1, Math.floor((price - low) / size))) : 0);
  for (const b of bars) {
    const vol = barVolume(b);
    if (vol === 0) continue;
    const bl = Math.min(b.low, b.high);
    const bh = Math.max(b.low, b.high);
    const up = b.close >= b.open;
    const add = (i: number, v: number) => {
      if (up) rows[i].up += v;
      else rows[i].down += v;
    };
    if (bh === bl || size === 0) {
      add(rowOf(bl), vol);
      continue;
    }
    const a = rowOf(bl);
    const z = Math.min(n - 1, Math.max(a, Math.ceil((bh - low) / size) - 1));
    let given = 0;
    for (let i = a; i <= z; i++) {
      const overlap = Math.max(0, Math.min(bh, rows[i].high) - Math.max(bl, rows[i].low));
      const share = i === z ? vol - given : (vol * overlap) / (bh - bl);
      given += share;
      add(i, share);
    }
  }
  let maxTotal = 0;
  let total = 0;
  let poc = -1;
  rows.forEach((r, i) => {
    r.total = r.up + r.down;
    total += r.total;
    if (r.total > maxTotal) {
      maxTotal = r.total;
      poc = i;
    }
  });
  let vaLowRow = -1;
  let vaHighRow = -1;
  if (poc >= 0) {
    vaLowRow = vaHighRow = poc;
    if (opts.valueAreaPct >= 100) {
      vaLowRow = 0;
      vaHighRow = n - 1;
    } else {
      const target = (total * opts.valueAreaPct) / 100;
      let acc = rows[poc].total;
      while (acc < target - total * 1e-12 && (vaLowRow > 0 || vaHighRow < n - 1)) {
        const above = vaHighRow < n - 1 ? rows[vaHighRow + 1].total : -1;
        const below = vaLowRow > 0 ? rows[vaLowRow - 1].total : -1;
        // The larger neighbour joins; on a tie the lower one, as the point of control does.
        if (below >= above) acc += rows[--vaLowRow].total;
        else acc += rows[++vaHighRow].total;
      }
    }
  }
  return {
    low,
    high,
    rows,
    maxTotal,
    total,
    poc,
    vaLowRow,
    vaHighRow,
    vaLow: poc >= 0 ? rows[vaLowRow].low : null,
    vaHigh: poc >= 0 ? rows[vaHighRow].high : null,
  };
}

export const volumeProfile = memoOnCandles('profile', volumeProfileRaw);
