/** Seeded synthetic candles and imperfect highlights, shared by the engine's tests. */
import { buildSignals } from '../../lib/backtest/strategies';
import { mulberry32 } from '../../lib/random';
import type { Candle } from '../../types';
import { marksOf } from './match';
import type { HighlightTrade } from './types';

export function normal(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand());
}

export function synth(bars: number, seed: number, t0 = 1_600_000_000): Candle[] {
  const rand = mulberry32(seed);
  const out: Candle[] = [];
  let price = 100;
  let trend = 0;
  for (let i = 0; i < bars; i++) {
    trend = trend * 0.98 + normal(rand) * 0.00012;
    const open = price;
    const close = Math.max(0.5, open * (1 + trend + normal(rand) * 0.006));
    out.push({ time: t0 + i * 3600, open, high: Math.max(open, close) * 1.002, low: Math.min(open, close) * 0.998, close, volume: 1000 });
    price = close;
  }
  return out;
}

/**
 * Highlights from a hidden long strategy (default sma_cross 8/34), 15% dropped and 30% of marks shifted by 1 to 3
 * bars.
 */
export function highlights(
  candles: Candle[],
  seed: number,
  strategyId = 'sma_cross',
  params: Record<string, number> = { fast: 8, slow: 34, direction: 1 },
): HighlightTrade[] {
  const rand = mulberry32(seed);
  const m = marksOf(buildSignals(candles, strategyId, params));
  const n = candles.length;
  const shift = (b: number): number => {
    if (rand() >= 0.3) return b;
    const d = 1 + Math.floor(rand() * 3);
    return Math.min(n - 1, Math.max(0, b + (rand() < 0.5 ? -d : d)));
  };
  const out: HighlightTrade[] = [];
  m.entries.forEach((e, i) => {
    const x = m.exits.find((v) => v > e);
    if (x == null || (m.entries[i + 1] != null && x > m.entries[i + 1])) return;
    if (rand() < 0.15) return;
    const a = shift(e);
    const b = Math.max(a, shift(x));
    out.push({ side: 'long', entryTime: candles[a].time, exitTime: candles[b].time });
  });
  return out;
}
