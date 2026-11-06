/** The exit grid of the market search: a stop sized by the typical bar range, with a take profit as a multiple of it. */
import type { Candle } from '../../types';
import type { ExitGrid } from './types';

export const DEFAULT_EXITS: ExitGrid = { stopMults: [1, 2, 4], tpMults: [1, 1.5, 2, 3, 4, 5] };

export const exitCount = (g: ExitGrid): number => g.stopMults.length * g.tpMults.length;

/** The median of (high - low) / close over the candles, in percent. 0 without candles. */
export function typicalRangePct(candles: Candle[]): number {
  const r = candles.filter((c) => c.close > 0).map((c) => ((c.high - c.low) / c.close) * 100);
  if (!r.length) return 0;
  r.sort((a, b) => a - b);
  const m = r.length >> 1;
  return r.length % 2 ? r[m] : (r[m - 1] + r[m]) / 2;
}

/** Every exit as stop and take profit percents (stop outermost). */
export function exitsOf(range: number, g: ExitGrid): Array<{ stopLossPct: number; takeProfitPct: number }> {
  const out: Array<{ stopLossPct: number; takeProfitPct: number }> = [];
  for (const s of g.stopMults) for (const t of g.tpMults) out.push({ stopLossPct: range * s, takeProfitPct: range * s * t });
  return out;
}
