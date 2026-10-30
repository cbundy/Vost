/**
 * Performance metrics computed from the equity curve and trade list.
 */
import type { Candle } from '../../types';
import type { EquityPoint, Metrics, Trade } from './types';

const YEAR_SECONDS = 365.25 * 24 * 3600;

/** Equity of simply holding the asset: the initial capital scaled by close over the first close (fees and slippage ignored). */
export function buyHoldCurve(candles: Candle[], initialCapital: number): number[] {
  if (candles.length === 0) return [];
  const first = candles[0].close;
  if (!(first > 0)) return candles.map(() => initialCapital);
  return candles.map((c) => (initialCapital * c.close) / first);
}

export function medianBarSeconds(equity: EquityPoint[]): number {
  const diffs: number[] = [];
  const step = Math.max(1, Math.floor(equity.length / 2000));
  for (let i = step; i < equity.length; i += step) {
    const d = equity[i].time - equity[i - step].time;
    if (d > 0) diffs.push(d);
  }
  if (diffs.length === 0) return 86400;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function computeMetrics(
  candles: Candle[],
  equity: EquityPoint[],
  trades: Trade[],
  initialCapital: number,
  exposureBars: number,
): Metrics {
  const last = equity[equity.length - 1];
  const finalEquity = last ? last.equity : initialCapital;
  const totalReturnPct = initialCapital > 0 ? (finalEquity / initialCapital - 1) * 100 : 0;

  const barSeconds = medianBarSeconds(equity);
  const barsPerYear = Math.max(1, Math.round(YEAR_SECONDS / Math.max(1, barSeconds)));

  const firstTime = equity[0]?.time ?? 0;
  const lastTime = last?.time ?? firstTime;
  const years = (lastTime - firstTime) / YEAR_SECONDS;
  const cagrPct =
    years > 0.019 && finalEquity > 0 && initialCapital > 0
      ? (Math.pow(finalEquity / initialCapital, 1 / years) - 1) * 100
      : null;

  // Per-bar returns.
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1].equity;
    if (prev > 0) returns.push(equity[i].equity / prev - 1);
  }
  const meanRet = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const sd = stdev(returns);
  const sharpe = returns.length > 1 && sd > 0 ? (meanRet / sd) * Math.sqrt(barsPerYear) : null;

  const downside = returns.filter((r) => r < 0);
  const ddSd =
    downside.length > 1 ? Math.sqrt(downside.reduce((a, b) => a + b * b, 0) / downside.length) : 0;
  const sortino = returns.length > 1 && ddSd > 0 ? (meanRet / ddSd) * Math.sqrt(barsPerYear) : null;

  // Drawdown.
  let maxDrawdownPct = 0;
  let maxDrawdownBars = 0;
  let currentDdBars = 0;
  for (const p of equity) {
    if (p.drawdownPct < maxDrawdownPct) maxDrawdownPct = p.drawdownPct;
    if (p.drawdownPct < -0.0001) {
      currentDdBars++;
      if (currentDdBars > maxDrawdownBars) maxDrawdownBars = currentDdBars;
    } else {
      currentDdBars = 0;
    }
  }
  const calmar = cagrPct != null && maxDrawdownPct < 0 ? cagrPct / Math.abs(maxDrawdownPct) : null;

  // Trade stats.
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl <= 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const profitFactor = trades.length === 0 ? null : grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Number.POSITIVE_INFINITY : null;
  const winRatePct = trades.length > 0 ? (wins.length / trades.length) * 100 : null;
  const mean = (xs: number[]): number | null => (xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const pnls = trades.map((t) => t.pnl);
  const pnlPcts = trades.map((t) => t.pnlPct);

  const totalBars = Math.max(1, equity.length);

  return {
    initialCapital,
    finalEquity,
    totalReturnPct,
    cagrPct,
    sharpe,
    sortino,
    calmar,
    maxDrawdownPct,
    maxDrawdownBars,
    exposurePct: (exposureBars / totalBars) * 100,
    buyHoldPct: candles.length > 1 && candles[0].close > 0 ? (candles[candles.length - 1].close / candles[0].close - 1) * 100 : 0,
    trades: trades.length,
    winRatePct,
    profitFactor,
    expectancy: mean(pnls),
    avgTradePct: mean(pnlPcts),
    bestTradePct: pnlPcts.length > 0 ? Math.max(...pnlPcts) : null,
    worstTradePct: pnlPcts.length > 0 ? Math.min(...pnlPcts) : null,
    avgBarsInTrade: mean(trades.map((t) => t.bars)),
    totalFees: trades.reduce((a, t) => a + t.fees, 0),
    barsPerYear,
  };
}
