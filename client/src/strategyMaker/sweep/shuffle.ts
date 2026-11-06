/** The chance baseline's shuffled copy of a market: the same bars with the order of their moves mixed up. */
import { mulberry32 } from '../../lib/random';
import type { Candle } from '../../types';

/** The baseline's seed offset (the study's). */
const BASELINE_SEED = 409;

/** A seed from text (FNV-1a, offset by the baseline seed): the same text always gives the same seed. */
export function seedOf(text: string): number {
  let h = 2166136261 ^ BASELINE_SEED;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Same bars, the order of their moves shuffled: the gap from the last close, and the high, low and close relative to
 * the open, move together, and each bar's volume moves with its own move. The spread of moves stays and any pattern in
 * time is gone. Times stay in place and the first bar is kept. Fewer than 3 bars come back as they were.
 */
export function shuffledCopy(candles: Candle[], seed: number): Candle[] {
  if (candles.length < 3) return candles;
  const rand = mulberry32(seed);
  const moves = candles.slice(1).map((c, i) => ({
    t: [c.open / candles[i].close, c.high / c.open, c.low / c.open, c.close / c.open],
    volume: c.volume,
  }));
  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [moves[i], moves[j]] = [moves[j], moves[i]];
  }
  const out: Candle[] = [candles[0]];
  let prev = candles[0].close;
  moves.forEach((m, i) => {
    const open = prev * m.t[0];
    const close = open * m.t[3];
    out.push({
      time: candles[i + 1].time,
      open,
      high: Math.max(open * m.t[1], open, close),
      low: Math.min(open * m.t[2], open, close),
      close,
      volume: m.volume,
    });
    prev = close;
  });
  return out;
}
