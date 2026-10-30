/**
 * Event-driven, single-position backtest engine.
 *
 * Execution model (realistic, no look-ahead):
 *  - A signal computed on the close of bar `i` is executed at the OPEN of
 *    bar `i + 1` (classic "next bar open" fills).
 *  - Stops / take profits are checked intra-bar against high/low. When both
 *    could have been hit within the same bar, the STOP is assumed to trigger
 *    first (conservative/worst case). Gap-throughs fill at the open.
 *  - Fees (bps) are charged on both entry and exit notionals; slippage (bps)
 *    is applied against the trader on every fill.
 *  - Equity is marked to market on every close; drawdown is tracked against
 *    the running peak.
 */
import type { Candle } from '../../types';
import type { BacktestConfig, EquityPoint, ExitReason, Signal, Trade } from './types';

export interface EngineOutput {
  trades: Trade[];
  equity: EquityPoint[];
  exposureBars: number;
}

interface OpenPosition {
  side: -1 | 1;
  qty: number;
  entryPrice: number;
  entryTime: number;
  entryBar: number;
  entryFee: number;
  entryNotional: number;
}

function coerceSignal(v: unknown): Signal {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

export function runBacktest(
  candles: Candle[],
  rawSignals: unknown[],
  config: BacktestConfig,
  /** Fraction of bars simulated (0..1), about 100 calls per run, the last one at 1. */
  onProgress?: (pct: number) => void,
): EngineOutput {
  const n = candles.length;
  const trades: Trade[] = [];
  const equity: EquityPoint[] = [];
  if (n < 2) return { trades, equity, exposureBars: 0 };

  const signals: Signal[] = rawSignals.map(coerceSignal);

  const feeRate = Math.max(0, config.feeBps) / 10000;
  const slip = Math.max(0, config.slippageBps) / 10000;
  const sizePct = Math.min(100, Math.max(1, config.positionSizePct)) / 100;
  const stopPct = config.stopLossPct != null && config.stopLossPct > 0 ? config.stopLossPct : null;
  const tpPct = config.takeProfitPct != null && config.takeProfitPct > 0 ? config.takeProfitPct : null;

  let cash = config.initialCapital; // realised equity
  let position: OpenPosition | null = null;
  /** After a stop/TP exit, require the signal to leave that side before re-entering. */
  let requireReset: -1 | 1 | null = null;
  let peak = config.initialCapital;
  let exposureBars = 0;
  let tradeId = 0;
  let totalFees = 0;

  const fillBuy = (price: number): number => price * (1 + slip);
  const fillSell = (price: number): number => price * (1 - slip);

  const unrealized = (pos: OpenPosition, price: number): number => (price - pos.entryPrice) * pos.qty * pos.side;

  const closePosition = (pos: OpenPosition, rawPrice: number, barIndex: number, reason: ExitReason): void => {
    const fill = pos.side === 1 ? fillSell(rawPrice) : fillBuy(rawPrice);
    const gross = (fill - pos.entryPrice) * pos.qty * pos.side;
    const exitFee = pos.qty * fill * feeRate;
    totalFees += exitFee;
    cash += gross - exitFee;
    const pnl = gross - pos.entryFee - exitFee;
    trades.push({
      id: ++tradeId,
      side: pos.side === 1 ? 'long' : 'short',
      qty: pos.qty,
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      entryBar: pos.entryBar,
      exitTime: candles[barIndex].time,
      exitPrice: fill,
      exitBar: barIndex,
      pnl,
      pnlPct: pos.entryNotional > 0 ? (pnl / pos.entryNotional) * 100 : 0,
      fees: pos.entryFee + exitFee,
      bars: barIndex - pos.entryBar,
      exitReason: reason,
    });
  };

  const openPosition = (side: -1 | 1, rawPrice: number, barIndex: number): OpenPosition => {
    const fill = side === 1 ? fillBuy(rawPrice) : fillSell(rawPrice);
    const notional = Math.max(0, cash) * sizePct;
    const qty = fill > 0 ? notional / fill : 0;
    const entryFee = qty * fill * feeRate;
    totalFees += entryFee;
    cash -= entryFee;
    return {
      side,
      qty,
      entryPrice: fill,
      entryTime: candles[barIndex].time,
      entryBar: barIndex,
      entryFee,
      entryNotional: notional,
    };
  };

  equity.push({
    time: candles[0].time,
    equity: config.initialCapital,
    drawdownPct: 0,
    position: 0,
  });

  const reportEvery = Math.max(1, Math.floor(n / 100));
  for (let i = 1; i < n; i++) {
    const bar = candles[i];

    // ---- 1. Execute the target decided on the previous close -------------
    let target = signals[i - 1];
    if (target != null) {
      if (requireReset != null) {
        if (target === requireReset) {
          target = 0; // still pointing at the side we were stopped out of
        } else {
          requireReset = null;
        }
      }
      if (target === -1 && !config.allowShort) target = 0;

      const currentSide = position ? position.side : 0;
      if (target !== currentSide) {
        if (position) {
          closePosition(position, bar.open, i, 'signal');
          position = null;
        }
        if (target !== 0 && cash > 0) {
          position = openPosition(target, bar.open, i);
        }
      }
    }

    // ---- 2. Intra-bar stop loss / take profit ----------------------------
    if (position) {
      const pos = position;
      const stopPrice = stopPct != null ? pos.entryPrice * (1 - (pos.side === 1 ? stopPct : -stopPct) / 100) : null;
      const tpPrice = tpPct != null ? pos.entryPrice * (1 + (pos.side === 1 ? tpPct : -tpPct) / 100) : null;

      let exitPrice: number | null = null;
      let reason: ExitReason | null = null;

      if (pos.side === 1) {
        if (stopPrice != null && bar.low <= stopPrice) {
          exitPrice = bar.open <= stopPrice ? bar.open : stopPrice; // gap-through fills at open
          reason = 'stop_loss';
        } else if (tpPrice != null && bar.high >= tpPrice) {
          exitPrice = bar.open >= tpPrice ? bar.open : tpPrice;
          reason = 'take_profit';
        }
      } else {
        if (stopPrice != null && bar.high >= stopPrice) {
          exitPrice = bar.open >= stopPrice ? bar.open : stopPrice;
          reason = 'stop_loss';
        } else if (tpPrice != null && bar.low <= tpPrice) {
          exitPrice = bar.open <= tpPrice ? bar.open : tpPrice;
          reason = 'take_profit';
        }
      }

      if (exitPrice != null && reason != null) {
        closePosition(pos, exitPrice, i, reason);
        position = null;
        requireReset = pos.side;
      }
    }

    // ---- 3. Mark to market ------------------------------------------------
    const closePrice = bar.close;
    const eq = cash + (position ? unrealized(position, closePrice) : 0);
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (eq / peak - 1) * 100 : 0;
    if (position) exposureBars++;
    equity.push({
      time: bar.time,
      equity: eq,
      drawdownPct: dd,
      position: position ? position.side : 0,
    });
    if (onProgress && (i % reportEvery === 0 || i === n - 1)) onProgress(i / (n - 1));
  }

  // ---- 4. Force-close anything still open at the last close --------------
  if (position) {
    closePosition(position, candles[n - 1].close, n - 1, 'end_of_data');
    position = null;
    const eq = cash;
    if (eq > peak) peak = eq;
    const last = equity[equity.length - 1];
    last.equity = eq;
    last.drawdownPct = peak > 0 ? (eq / peak - 1) * 100 : 0;
    last.position = 0;
  }

  return { trades, equity, exposureBars };
}

export { coerceSignal };
