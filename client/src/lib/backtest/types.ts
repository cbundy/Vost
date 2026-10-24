/**
 * Backtest domain types.
 *
 * Position sizing note: this is a single-position, margin-style simulation.
 * `positionSizePct` of the current equity is committed to every trade, fees
 * and slippage are applied on both sides, and shorts are supported when
 * enabled in the configuration.
 */

/** Desired exposure for a bar: 1 long, -1 short, 0 flat, null = "not computed yet". */
export type Signal = -1 | 0 | 1 | null;

export interface BacktestConfig {
  strategyId: string;
  params: Record<string, number>;
  /** Only for the `custom` strategy. */
  customCode?: string;
  /** Only for the `pine` strategy: Pine Script v6 strategy source. */
  pineCode?: string;
  initialCapital: number;
  /** Percent of equity committed per trade (1–100). */
  positionSizePct: number;
  /** Taker fee in basis points per side (10 bps = 0.1%). */
  feeBps: number;
  /** Slippage in basis points per fill. */
  slippageBps: number;
  allowShort: boolean;
  /** Stop loss distance in percent (null disables). */
  stopLossPct: number | null;
  /** Take profit distance in percent (null disables). */
  takeProfitPct: number | null;
}

export type ExitReason = 'signal' | 'stop_loss' | 'take_profit' | 'end_of_data';

export interface Trade {
  id: number;
  side: 'long' | 'short';
  qty: number;
  entryTime: number;
  entryPrice: number;
  entryBar: number;
  exitTime: number;
  exitPrice: number;
  exitBar: number;
  /** Net PnL in currency (fees included). */
  pnl: number;
  /** Net PnL relative to entry notional, in percent. */
  pnlPct: number;
  fees: number;
  bars: number;
  exitReason: ExitReason;
}

export interface EquityPoint {
  time: number;
  equity: number;
  drawdownPct: number;
  position: -1 | 0 | 1;
}

export interface Metrics {
  initialCapital: number;
  finalEquity: number;
  totalReturnPct: number;
  cagrPct: number | null;
  sharpe: number | null;
  sortino: number | null;
  calmar: number | null;
  maxDrawdownPct: number;
  maxDrawdownBars: number;
  exposurePct: number;
  buyHoldPct: number;
  trades: number;
  winRatePct: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  avgTradePct: number | null;
  bestTradePct: number | null;
  worstTradePct: number | null;
  avgBarsInTrade: number | null;
  totalFees: number;
  barsPerYear: number;
}

export interface BacktestResult {
  trades: Trade[];
  equity: EquityPoint[];
  metrics: Metrics;
  config: BacktestConfig;
  signals?: Signal[];
}

export function defaultBacktestConfig(): BacktestConfig {
  return {
    strategyId: 'sma_cross',
    params: { fast: 10, slow: 30, direction: 1 },
    initialCapital: 10000,
    positionSizePct: 100,
    feeBps: 10,
    slippageBps: 5,
    allowShort: false,
    stopLossPct: null,
    takeProfitPct: null,
  };
}
