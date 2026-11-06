/**
 * Labels each marked trade with a trading style from the bars up to and including its entry bar, and works out which
 * strategy families that style points at. Pure: no DOM, no React.
 */
import { atr, ema, highest, lowest, rsi, sma, stdev } from '../../lib/indicators';
import { stylesOf, type StrategyStyle } from '../../lib/backtest/strategies';
import { usedTrades } from './match';
import type { SearchDirection, SeriesInput } from './types';

export type TradeStyleLabel = StrategyStyle | 'unclear';

/** One classified trade. `series` and `index` are as in the engine's skipped-trade list. */
export interface TradeStyle {
  series: number;
  index: number;
  side: 'long' | 'short';
  entryTime: number;
  style: TradeStyleLabel;
  reason: string;
}

export interface StyleReport {
  trades: TradeStyle[];
  counts: Record<TradeStyleLabel, number>;
  /** The styles the search was narrowed to (empty when the trades lean no clear way). */
  leading: StrategyStyle[];
  /** True when the search was narrowed to the families of the leading styles. */
  applied: boolean;
  /** The families searched after this step (before the model narrows them further). */
  families: string[];
  /** Why the search was not narrowed, or that it fell back. */
  note: string | null;
}

/** The thresholds, stated in the guide. */
export const STYLE_THRESHOLDS = {
  slowEma: 200,
  midEma: 50,
  reversalWindow: 50,
  reversalRecent: 5,
  zLength: 20,
  zLimit: 2,
  rsiLength: 14,
  rsiLow: 30,
  rsiHigh: 70,
  momentumBars: 20,
  momentumAtrMult: 4,
  atrLength: 14,
  breakoutBars: 20,
  fastEma: 10,
  crossEma: 30,
  crossRecent: 5,
  pullbackBars: 5,
  /** The top style must hold at least this share of the used trades for the search to be narrowed. */
  leadShare: 0.4,
  /** A style also leads when it holds at least this share of the top style's count. */
  alsoLeadShare: 0.5,
} as const;

const T = STYLE_THRESHOLDS;

export const STYLE_NAMES: Record<TradeStyleLabel, string> = {
  trend: 'trend following',
  continuation: 'trend continuation',
  mean_reversion: 'mean reversion',
  reversal: 'reversal',
  breakout: 'breakout',
  momentum: 'momentum',
  unclear: 'no clear style',
};

const ORDER: TradeStyleLabel[] = ['trend', 'continuation', 'mean_reversion', 'reversal', 'breakout', 'momentum', 'unclear'];
const SIX = ORDER.slice(0, 6) as StrategyStyle[];

export function emptyCounts(): Record<TradeStyleLabel, number> {
  return { trend: 0, continuation: 0, mean_reversion: 0, reversal: 0, breakout: 0, momentum: 0, unclear: 0 };
}

interface Reading {
  closes: number[];
  highs: number[];
  lows: number[];
  ema10: (number | null)[];
  ema30: (number | null)[];
  ema50: (number | null)[];
  ema200: (number | null)[];
  sma20: (number | null)[];
  sd20: (number | null)[];
  rsi14: (number | null)[];
  atr14: (number | null)[];
  hi20: (number | null)[];
  lo20: (number | null)[];
}

function read(candles: SeriesInput['candles']): Reading {
  const closes = candles.map((c) => c.close);
  return {
    closes,
    highs: candles.map((c) => c.high),
    lows: candles.map((c) => c.low),
    ema10: ema(closes, T.fastEma),
    ema30: ema(closes, T.crossEma),
    ema50: ema(closes, T.midEma),
    ema200: ema(closes, T.slowEma),
    sma20: sma(closes, T.zLength),
    sd20: stdev(closes, T.zLength),
    rsi14: rsi(closes, T.rsiLength),
    atr14: atr(candles, T.atrLength),
    hi20: highest(candles.map((c) => c.high), T.breakoutBars),
    lo20: lowest(candles.map((c) => c.low), T.breakoutBars),
  };
}

const f = (n: number, d = 1): string => n.toFixed(d);

/** The style of one entry at bar `i`, reading only bars 0..i. */
function classifyAt(r: Reading, i: number, side: 'long' | 'short'): { style: TradeStyleLabel; reason: string } {
  const s = side === 'long' ? 1 : -1;
  const e50 = r.ema50[i];
  const e200 = r.ema200[i];
  if (e50 == null || e200 == null || i < T.reversalWindow) return { style: 'unclear', reason: 'too early in the data to read' };
  const trend = Math.sign(e50 - e200);
  const close = r.closes[i];

  // 2. reversal: against the slow trend, at a fresh 50-bar extreme against the trade
  if (trend === -s) {
    const ext = side === 'long' ? r.lows : r.highs;
    const pick = side === 'long' ? Math.min : Math.max;
    const recent = pick(...ext.slice(i - T.reversalRecent + 1, i + 1));
    const wide = pick(...ext.slice(i - T.reversalWindow + 1, i + 1));
    if (recent === wide) {
      return {
        style: 'reversal',
        reason: `the ${T.midEma}-bar average is ${side === 'long' ? 'below' : 'above'} the ${T.slowEma}-bar one and the ${side === 'long' ? 'lowest low' : 'highest high'} of the last ${T.reversalWindow} bars came within the last ${T.reversalRecent}`,
      };
    }
  }

  // 3. mean reversion: stretched from the 20-bar mean, or RSI at an extreme
  const m = r.sma20[i];
  const sd = r.sd20[i];
  if (m != null && sd != null && sd > 0) {
    const z = (close - m) / sd;
    if (s * z <= -T.zLimit) return { style: 'mean_reversion', reason: `price is ${f(Math.abs(z))} standard deviations ${side === 'long' ? 'below' : 'above'} its ${T.zLength}-bar average` };
  }
  const rs = r.rsi14[i];
  if (rs != null && (side === 'long' ? rs <= T.rsiLow : rs >= T.rsiHigh)) {
    return { style: 'mean_reversion', reason: `RSI ${T.rsiLength} is ${f(rs, 0)}, ${side === 'long' ? 'oversold' : 'overbought'}` };
  }

  // 4. momentum: with the slow trend, and a big move in the trade's direction
  const a = r.atr14[i];
  if (trend === s && a != null && i >= T.momentumBars) {
    const move = s * (close / r.closes[i - T.momentumBars] - 1);
    const need = (T.momentumAtrMult * a) / close;
    if (move >= need) return { style: 'momentum', reason: `price moved ${f(move * 100)}% in ${T.momentumBars} bars with the trend, at least ${T.momentumAtrMult} times the ATR (${f(need * 100)}%)` };
  }

  // 5. breakout: through the prior 20-bar range
  if (i >= T.breakoutBars) {
    const hi = r.hi20[i - 1];
    const lo = r.lo20[i - 1];
    if (side === 'long' && hi != null && close > hi) return { style: 'breakout', reason: `the close went above the highest high of the prior ${T.breakoutBars} bars` };
    if (side === 'short' && lo != null && close < lo) return { style: 'breakout', reason: `the close went below the lowest low of the prior ${T.breakoutBars} bars` };
  }

  // 6. trend following: a fresh EMA 10 / EMA 30 cross to the trade's side
  for (let j = Math.max(1, i - T.crossRecent + 1); j <= i; j++) {
    const d = (k: number): number | null => (r.ema10[k] != null && r.ema30[k] != null ? (r.ema10[k] as number) - (r.ema30[k] as number) : null);
    const now = d(j);
    const before = d(j - 1);
    if (now != null && before != null && s * now > 0 && s * before <= 0) {
      return { style: 'trend', reason: `the ${T.fastEma}-bar average crossed ${side === 'long' ? 'above' : 'below'} the ${T.crossEma}-bar one within the last ${T.crossRecent} bars` };
    }
  }

  // 7. continuation: with the slow trend, after a small step against it
  if (trend === s && i >= T.pullbackBars + 1) {
    const back = s * (r.closes[i - 1] / r.closes[i - 1 - T.pullbackBars] - 1);
    if (back < 0) return { style: 'continuation', reason: `the slow trend is ${side === 'long' ? 'up' : 'down'} and the ${T.pullbackBars} bars before entry moved against the trade` };
  }
  return { style: 'unclear', reason: 'it fits none of the styles' };
}

/** Labels each trade that the search would use. */
export function classifyTrades(series: SeriesInput[], direction: SearchDirection): TradeStyle[] {
  const out: TradeStyle[] = [];
  series.forEach((s, si) => {
    if (!s.candles.length) return;
    const r = read(s.candles);
    for (const t of usedTrades(s.candles, s.trades, si, direction, [])) {
      const { style, reason } = classifyAt(r, t.entry, t.side);
      out.push({ series: si, index: t.index, side: t.side, entryTime: s.trades[t.index].entryTime, style, reason });
    }
  });
  return out;
}

export function countStyles(trades: readonly TradeStyle[]): Record<TradeStyleLabel, number> {
  const c = emptyCounts();
  for (const t of trades) c[t.style]++;
  return c;
}

/** The top style (it needs at least 40% of the trades) plus any style with at least half its count; none when no style leads. */
export function leadingStyles(counts: Record<TradeStyleLabel, number>): StrategyStyle[] {
  const total = ORDER.reduce((n, k) => n + counts[k], 0);
  if (!total) return [];
  const top = Math.max(...SIX.map((k) => counts[k]));
  if (top === 0 || top < T.leadShare * total) return [];
  return SIX.filter((k) => counts[k] > 0 && counts[k] >= T.alsoLeadShare * top).sort((a, b) => counts[b] - counts[a]);
}

/** The allowed families that share a style with a leading one; every allowed family, with a note, when none do. */
export function styleFamilies(allowed: readonly string[], leading: readonly StrategyStyle[]): { families: string[]; applied: boolean; note: string | null } {
  if (!leading.length) return { families: [...allowed], applied: false, note: 'Your trades do not lean to one style, so every allowed family was searched.' };
  const picked = allowed.filter((id) => stylesOf(id).some((s) => leading.includes(s)));
  if (!picked.length) {
    return { families: [...allowed], applied: false, note: 'None of the allowed families match the style of your trades, so every allowed family was searched.' };
  }
  return { families: picked, applied: true, note: null };
}

/** The whole report. With `useStyle` off the families stay as allowed. */
export function buildStyleReport(trades: TradeStyle[], allowed: readonly string[], useStyle: boolean): StyleReport {
  const counts = countStyles(trades);
  const leading = leadingStyles(counts);
  if (!useStyle) return { trades, counts, leading, applied: false, families: [...allowed], note: null };
  const { families, applied, note } = styleFamilies(allowed, leading);
  return { trades, counts, leading, applied, families, note };
}
