/**
 * Pine Script backtests. Trades come from Pine's own strategy emulation
 * (runPine); this module converts them to Vost trades, builds a per-bar
 * mark-to-market equity curve and reuses computeMetrics.
 */
import type { Candle } from '../../types';
import { DEFAULT_PINE_CODE } from '../pine/examples';
import { runPine } from '../pine/runtime';
import type { PineInputValue, PineResult, PineStrategyConfig } from '../pine/types';
import { computeMetrics } from './metrics';
import type { BacktestConfig, BacktestResult, EquityPoint, Trade } from './types';

export const INDICATOR_MESSAGE = 'This is an indicator script; add it to the chart instead of backtesting it.';

/** Pine's own defaults (what PineTS reports when strategy() omits the argument). */
const PINE_DEFAULT_CAPITAL = 1_000_000;

interface FeeModel {
  /** Fee for one side (entry or exit) of a trade. */
  side(price: number, qty: number): number;
  bps: number;
}

/** Which settings a run used: the script wins over the panel when it sets them. */
export function resolveSettings(
  cfg: PineStrategyConfig | undefined,
  panel: { initialCapital: number; feeBps: number },
): { initialCapital: number; feeBps: number; scriptCapital: boolean; scriptCommission: boolean } {
  const scriptCapital = !!cfg && cfg.initialCapital > 0 && cfg.initialCapital !== PINE_DEFAULT_CAPITAL;
  const scriptCommission = !!cfg && cfg.commissionValue > 0;
  return {
    initialCapital: scriptCapital ? cfg!.initialCapital : panel.initialCapital,
    feeBps: scriptCommission && cfg!.commissionType === 'percent' ? cfg!.commissionValue * 100 : panel.feeBps,
    scriptCapital,
    scriptCommission,
  };
}

function feeModel(cfg: PineStrategyConfig | undefined, panelBps: number, scriptCommission: boolean): FeeModel {
  if (scriptCommission && cfg) {
    const v = cfg.commissionValue;
    if (cfg.commissionType === 'cash_per_order') return { side: () => v, bps: 0 };
    if (cfg.commissionType === 'cash_per_contract') return { side: (_p, q) => v * q, bps: 0 };
    return { side: (p, q) => (p * q * v) / 100, bps: v * 100 };
  }
  return { side: (p, q) => (p * q * panelBps) / 10000, bps: panelBps };
}

export async function runPineBacktest(candles: Candle[], config: BacktestConfig): Promise<BacktestResult> {
  if (candles.length < 3) throw new Error('Not enough data to run a backtest (need at least 3 bars).');
  const outcome = await runPine(
    config.pineCode ?? DEFAULT_PINE_CODE,
    candles,
    (config.params ?? {}) as Record<string, PineInputValue>,
  );
  if (!outcome.ok) {
    const { message, line } = outcome.error;
    throw new Error(line != null && !message.includes(`${line}:`) ? `${message} (line ${line})` : message);
  }
  if (outcome.kind !== 'strategy') throw new Error(INDICATOR_MESSAGE);
  return buildPineResult(candles, config, outcome);
}

export function buildPineResult(candles: Candle[], config: BacktestConfig, pine: PineResult): BacktestResult {
  const last = candles.length - 1;
  const used = resolveSettings(pine.strategyConfig, config);
  const fees = feeModel(pine.strategyConfig, config.feeBps, used.scriptCommission);
  // PineTS already deducts the script's own commission from `profit`; the panel fee is ours to deduct.
  const scriptFeesInProfit = used.scriptCommission;

  const trades: Trade[] = [];
  const sorted = [...pine.trades].sort((a, b) => a.entryIndex - b.entryIndex);
  for (const t of sorted) {
    const dir = t.direction === 'short' ? -1 : 1;
    const open = t.exitIndex == null || t.exitPrice == null;
    const exitBar = open ? last : t.exitIndex!;
    const exitPrice = open ? candles[last].close : t.exitPrice!;
    const gross = (exitPrice - t.entryPrice) * t.size * dir;
    let pnl: number;
    let fee: number;
    if (scriptFeesInProfit && !open && t.profit != null) {
      pnl = t.profit;
      fee = gross - pnl;
    } else {
      fee = fees.side(t.entryPrice, t.size) + fees.side(exitPrice, t.size);
      pnl = gross - fee;
    }
    const notional = t.entryPrice * t.size;
    trades.push({
      id: trades.length + 1,
      side: t.direction,
      qty: t.size,
      entryTime: t.entryTime,
      entryPrice: t.entryPrice,
      entryBar: t.entryIndex,
      exitTime: open ? candles[last].time : t.exitTime!,
      exitPrice,
      exitBar,
      pnl,
      pnlPct: notional > 0 ? (pnl / notional) * 100 : 0,
      fees: fee,
      bars: exitBar - t.entryIndex,
      exitReason: open ? 'end_of_data' : 'signal',
    });
  }

  // Per-bar mark-to-market: realised pnl of trades closed on or before the bar plus open P&L at the close.
  const realisedAt = new Array<number>(candles.length).fill(0);
  const positionAt = new Array<number>(candles.length).fill(0);
  const unrealised = new Array<number>(candles.length).fill(0);
  let exposureBars = 0;
  for (const t of trades) {
    realisedAt[t.exitBar] += t.pnl;
    const dir = t.side === 'short' ? -1 : 1;
    const entryFee = fees.side(t.entryPrice, t.qty);
    for (let i = Math.max(t.entryBar, 0); i < t.exitBar; i++) {
      unrealised[i] += (candles[i].close - t.entryPrice) * t.qty * dir - (scriptFeesInProfit ? 0 : entryFee);
      positionAt[i] = dir;
    }
  }
  const equity: EquityPoint[] = [];
  let realised = 0;
  let peak = used.initialCapital;
  for (let i = 0; i < candles.length; i++) {
    realised += realisedAt[i];
    const eq = used.initialCapital + realised + unrealised[i];
    peak = Math.max(peak, eq);
    if (positionAt[i] !== 0) exposureBars++;
    equity.push({
      time: candles[i].time,
      equity: eq,
      drawdownPct: peak > 0 ? (eq / peak - 1) * 100 : 0,
      position: positionAt[i] as -1 | 0 | 1,
    });
  }

  const usedConfig: BacktestConfig = { ...config, initialCapital: used.initialCapital, feeBps: used.feeBps };
  const metrics = computeMetrics(candles, equity, trades, used.initialCapital, exposureBars);
  return { trades, equity, metrics, config: usedConfig };
}
