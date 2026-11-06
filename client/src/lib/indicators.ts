/**
 * Technical indicators. All functions take a dense numeric input and return a
 * `Series` (same length as input) where `null` marks "not enough data yet".
 *
 * No look-ahead: value at index `i` only depends on data at indices `<= i`.
 */
import type { Candle, Series } from '../types';

export type NumOrNull = number | null;

/** Simple moving average. */
export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average, seeded with the SMA of the first `period` values. */
export function ema(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder-smoothed RSI. */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period || period <= 0) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

/** MACD (moving average convergence/divergence). */
export function macd(values: number[], fastPeriod = 12, slowPeriod = 26, signalPeriod = 9): MacdResult {
  const fast = ema(values, fastPeriod);
  const slow = ema(values, slowPeriod);
  const line: Series = values.map((_, i) => {
    const f = fast[i];
    const s = slow[i];
    return f != null && s != null ? f - s : null;
  });
  // Smooth only the dense section of the line.
  const firstIdx = line.findIndex((v) => v != null);
  const signal: Series = new Array(values.length).fill(null);
  const histogram: Series = new Array(values.length).fill(null);
  if (firstIdx >= 0) {
    const dense = line.slice(firstIdx) as number[];
    const smoothed = ema(dense, signalPeriod);
    for (let i = 0; i < smoothed.length; i++) {
      const v = smoothed[i];
      if (v != null) {
        signal[firstIdx + i] = v;
        histogram[firstIdx + i] = (line[firstIdx + i] as number) - v;
      }
    }
  }
  return { macd: line, signal, histogram };
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
}

/** Bollinger bands (population standard deviation). */
export function bollinger(values: number[], period = 20, mult = 2): BollingerResult {
  const middle = sma(values, period);
  const upper: Series = new Array(values.length).fill(null);
  const lower: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    const mean = middle[i] as number;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean;
      acc += d * d;
    }
    const sd = Math.sqrt(acc / period);
    upper[i] = mean + mult * sd;
    lower[i] = mean - mult * sd;
  }
  return { upper, middle, lower };
}

/** Average true range (Wilder smoothing). */
export function atr(candles: Candle[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  const tr = (i: number): number => {
    const c = candles[i];
    const prev = candles[i - 1];
    return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
  };
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr(i);
  let prev = sum / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr(i)) / period;
    out[i] = prev;
  }
  return out;
}

/** Simple moving average of bar volume; null until `period` bars exist. */
export function volumeSma(candles: Candle[], period: number): Series {
  return sma(
    candles.map((c) => c.volume),
    period,
  );
}

/**
 * Average directional index (Wilder). +DM, -DM and true range are Wilder-smoothed over `period`
 * (first value = sum of bars 1..period), DX = 100 x |+DI - -DI| / (+DI + -DI) (0 when the sum is 0),
 * and ADX is the mean of the first `period` DX values, then Wilder-averaged. First value at index 2 x period - 1.
 */
export function adx(candles: Candle[], period = 14): Series {
  const n = candles.length;
  const out: Series = new Array(n).fill(null);
  if (period < 1 || n < 2 * period) return out;
  let sTr = 0;
  let sPlus = 0;
  let sMinus = 0;
  let dxSum = 0;
  let prevAdx = 0;
  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
    const up = c.high - prev.high;
    const down = prev.low - c.low;
    const plus = up > down && up > 0 ? up : 0;
    const minus = down > up && down > 0 ? down : 0;
    if (i <= period) {
      sTr += tr;
      sPlus += plus;
      sMinus += minus;
    } else {
      sTr = sTr - sTr / period + tr;
      sPlus = sPlus - sPlus / period + plus;
      sMinus = sMinus - sMinus / period + minus;
    }
    if (i < period) continue;
    const pdi = sTr === 0 ? 0 : (100 * sPlus) / sTr;
    const mdi = sTr === 0 ? 0 : (100 * sMinus) / sTr;
    const sum = pdi + mdi;
    const dx = sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum;
    if (i < 2 * period - 1) {
      dxSum += dx;
    } else if (i === 2 * period - 1) {
      dxSum += dx;
      prevAdx = dxSum / period;
      out[i] = prevAdx;
    } else {
      prevAdx = (prevAdx * (period - 1) + dx) / period;
      out[i] = prevAdx;
    }
  }
  return out;
}

/**
 * VWAP. When `resetDaily` is true (intraday charts) it resets at every UTC day
 * boundary; otherwise it is a rolling VWAP over the last `rollingPeriod` bars.
 */
export function vwap(candles: Candle[], resetDaily: boolean, rollingPeriod = 20): Series {
  const out: Series = new Array(candles.length).fill(null);
  if (resetDaily) {
    let pv = 0;
    let vol = 0;
    let day = -1;
    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const d = Math.floor(c.time / 86400);
      if (d !== day) {
        day = d;
        pv = 0;
        vol = 0;
      }
      const typical = (c.high + c.low + c.close) / 3;
      pv += typical * c.volume;
      vol += c.volume;
      out[i] = vol > 0 ? pv / vol : typical;
    }
    return out;
  }
  let pv = 0;
  let vol = 0;
  const queue: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const typical = (c.high + c.low + c.close) / 3;
    pv += typical * c.volume;
    vol += c.volume;
    queue.push(typical * c.volume, c.volume);
    if (queue.length > rollingPeriod * 2) {
      pv -= queue.shift() as number;
      vol -= queue.shift() as number;
    }
    out[i] = vol > 0 ? pv / vol : typical;
  }
  return out;
}

/** Rolling highest value over the previous `period` entries (inclusive of i). */
export function highest(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let m = -Infinity;
    for (let j = i - period + 1; j <= i; j++) if (values[j] > m) m = values[j];
    out[i] = m;
  }
  return out;
}

/** Rolling lowest value over the previous `period` entries (inclusive of i). */
export function lowest(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let m = Infinity;
    for (let j = i - period + 1; j <= i; j++) if (values[j] < m) m = values[j];
    out[i] = m;
  }
  return out;
}

/** Standard deviation of a rolling window. */
export function stdev(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  for (let i = period - 1; i < values.length; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += values[j];
    mean /= period;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - mean;
      acc += d * d;
    }
    out[i] = Math.sqrt(acc / period);
  }
  return out;
}

/** True when `a` crossed above `b` at index `i` (a > b now, a <= b before). */
export function crossover(a: NumOrNull[], b: NumOrNull[], i: number): boolean {
  if (i < 1) return false;
  const a0 = a[i - 1];
  const b0 = b[i - 1];
  const a1 = a[i];
  const b1 = b[i];
  if (a0 == null || b0 == null || a1 == null || b1 == null) return false;
  return a0 <= b0 && a1 > b1;
}

/** True when `a` crossed below `b` at index `i`. */
export function crossunder(a: NumOrNull[], b: NumOrNull[], i: number): boolean {
  return crossover(b, a, i);
}

/**
 * Helper bag handed to custom strategies (and re-used by built-ins).
 */
export function indicatorHelpers(candles: Candle[], intraday: boolean) {
  const closes = candles.map((c) => c.close);
  return {
    sma: (values: number[] | undefined, period: number) => sma(values ?? closes, period),
    ema: (values: number[] | undefined, period: number) => ema(values ?? closes, period),
    rsi: (period: number) => rsi(closes, period),
    macd: (fast: number, slow: number, signal: number) => macd(closes, fast, slow, signal),
    bollinger: (period: number, mult: number) => bollinger(closes, period, mult),
    atr: (period: number) => atr(candles, period),
    adx: (period: number) => adx(candles, period),
    volumeSma: (period: number) => volumeSma(candles, period),
    vwap: () => vwap(candles, intraday),
    highest,
    lowest,
    stdev,
    crossover,
    crossunder,
  };
}

export type IndicatorHelpers = ReturnType<typeof indicatorHelpers>;
