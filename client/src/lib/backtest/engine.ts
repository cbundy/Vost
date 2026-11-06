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
import { atr } from '../indicators';
import { higherOfMultiple } from './higherTimeframe';
import { hitTest, levelsAtEntry, readExitSettings, updateTrail, type TradeLevels } from './exits';
import type { BacktestConfig, EquityPoint, ExitReason, Signal, Trade } from './types';

export interface EngineOutput {
  trades: Trade[];
  equity: EquityPoint[];
  exposureBars: number;
  /**
   * Entry signals that fired. A signal fires on executed bar `i` when `signals[i - 1]` is not null,
   * its side is non-zero after the shorts filter (-1 counts as 0 without `allowShort`), and that side
   * differs from the side of the last non-null signal before it (starting at 0). Null signals neither
   * fire nor reset the side. The last bar's signal is never executed, so it is not counted. Counted
   * before the `requireReset` rule, so a held-back signal still counts. Always >= trades.length.
   */
  signalsFired: number;
}

interface OpenPosition {
  side: -1 | 1;
  qty: number;
  entryPrice: number;
  entryTime: number;
  entryBar: number;
  entryFee: number;
  entryNotional: number;
  leverage?: number;
  levels: TradeLevels;
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
  if (n < 2) return { trades, equity, exposureBars: 0, signalsFired: 0 };

  const signals: Signal[] = rawSignals.map(coerceSignal);

  const feeRate = Math.max(0, config.feeBps) / 10000;
  const slip = Math.max(0, config.slippageBps) / 10000;
  const sizePct = Math.min(100, Math.max(1, config.positionSizePct)) / 100;
  const exits = readExitSettings(config);
  const atrHtf = exits.needsAtr && exits.atrTimeframe > 1 ? higherOfMultiple(candles, exits.atrTimeframe) : null;
  const atrSeries = exits.needsAtr ? atr(atrHtf ? atrHtf.bars : candles, exits.atrLength) : null;
  /** The ATR of the signal bar: on the loaded bars, or of the newest longer bar closed at the signal bar's close. */
  const atrAt = (signalBar: number): number | null => {
    if (!atrSeries || signalBar < 0) return null;
    if (!atrHtf) return atrSeries[signalBar];
    const j = atrHtf.lastClosed[signalBar];
    return j < 0 ? null : atrSeries[j];
  };
  const riskFrac = config.riskPct != null && Number.isFinite(config.riskPct) && config.riskPct > 0 ? Math.min(100, config.riskPct) / 100 : null;

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
      ...(pos.leverage != null ? { leverage: pos.leverage } : {}),
    });
  };

  const openPosition = (side: -1 | 1, rawPrice: number, barIndex: number): OpenPosition | null => {
    const fill = side === 1 ? fillBuy(rawPrice) : fillSell(rawPrice);
    // Levels come from the entry fill and the ATR of the signal bar; during ATR warm-up no trade opens.
    const levels = levelsAtEntry(exits, side, fill, atrAt(barIndex - 1));
    if (!levels) return null;
    const stopFrac = levels.stopFrac;
    const equityNow = Math.max(0, cash);
    // Risk sizing needs a stop distance; without one it falls back to a percent of equity.
    const notional = riskFrac != null && stopFrac != null ? (equityNow * riskFrac) / stopFrac : equityNow * sizePct;
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
      levels,
      leverage: riskFrac != null && stopFrac != null && equityNow > 0 ? notional / equityNow : undefined,
    };
  };

  equity.push({
    time: candles[0].time,
    equity: config.initialCapital,
    drawdownPct: 0,
    position: 0,
  });

  let signalsFired = 0;
  let lastSignalSide: Signal = 0;
  const reportEvery = Math.max(1, Math.floor(n / 100));
  for (let i = 1; i < n; i++) {
    const bar = candles[i];

    // ---- 1. Execute the target decided on the previous close -------------
    let target = signals[i - 1];
    if (target != null) {
      const filtered = target === -1 && !config.allowShort ? 0 : target;
      if (filtered !== 0 && filtered !== lastSignalSide) signalsFired++;
      lastSignalSide = filtered;
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
          position = openPosition(target, bar.open, i); // null while an ATR exit has no ATR yet
        }
      }
    }

    // ---- 2. Intra-bar stop loss / take profit ----------------------------
    if (position) {
      const pos = position;
      const hit = hitTest(pos.side, pos.levels, bar);

      if (hit) {
        closePosition(pos, hit.price, i, hit.reason);
        position = null;
        requireReset = pos.side;
      } else {
        updateTrail(pos.side, pos.levels, bar);
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

  return { trades, equity, exposureBars, signalsFired };
}

export { coerceSignal };
