/**
 * Backtest domain types.
 *
 * Position sizing note: this is a single-position, margin-style simulation.
 * `positionSizePct` of the current equity is committed to every trade, fees
 * and slippage are applied on both sides, and shorts are supported when
 * enabled in the configuration. When `riskPct` is set (and a stop loss is on)
 * each trade is instead sized so that hitting the stop loses `riskPct` of the
 * current equity, with no cap on the position (leverage is unlimited).
 */

import type { PineMarket } from '../pine/types';

/** The step a running backtest is in, reported with its progress. */
export type BacktestStage = 'signals' | 'simulating' | 'pine' | 'metrics';

/** Progress of a run: `pct` is 0..1 and never decreases; the last call is 1. */
export type BacktestProgress = (pct: number, stage: BacktestStage) => void;

/** Desired exposure for a bar: 1 long, -1 short, 0 flat, null = "not computed yet". */
export type Signal = -1 | 0 | 1 | null;

export interface BacktestConfig {
  strategyId: string;
  params: Record<string, number>;
  /** Only for the `pine` strategy: the text inputs (color, source, symbol, session, timeframe, string, text_area, string enums) by name. Numbers, times and bools live in `params`. */
  pineInputs?: Record<string, string>;
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
  /** Optional risk sizing: percent of current equity lost if the stop is hit (above 0, at most 100). Needs a stop loss; ignores `positionSizePct`. Absent = percent-of-equity sizing. */
  riskPct?: number;
  /** Stop loss distance in percent (null disables). */
  stopLossPct: number | null;
  /** Take profit distance in percent (null disables). */
  takeProfitPct: number | null;
  /**
   * Optional volatility exits. Absent, null, non-finite or not above 0 values, and an unknown mode, read as
   * today's percent behaviour (or off for the trailing stop).
   * `stopMode` 'atr' puts the stop `stopAtrMult` x ATR from the entry fill instead of `stopLossPct`.
   */
  stopMode?: 'pct' | 'atr';
  stopAtrMult?: number | null;
  /** 'atr': target `takeProfitAtrMult` x ATR from entry; 'r': target `takeProfitR` x the trade's initial stop distance (needs a stop or trailing stop, else off). */
  takeProfitMode?: 'pct' | 'atr' | 'r';
  takeProfitAtrMult?: number | null;
  takeProfitR?: number | null;
  /** Trailing stop: 'pct' keeps `trailPct` percent of the entry price, 'atr' keeps `trailAtrMult` x ATR, behind the best price since entry. The distance is fixed at entry. */
  trailMode?: 'off' | 'pct' | 'atr';
  trailPct?: number | null;
  trailAtrMult?: number | null;
  /** ATR period for every ATR exit (integer 1 to 500, default 14). The ATR is read on the signal bar, so a trade waits until it is known. */
  atrLength?: number;
  /** Which bars the ATR of every ATR exit is measured on: a multiple of the loaded bar length (1, 2, 3, 4, 6, 8, 12 or 24, default 1 = the loaded bars). A longer bar counts only once it has closed by the signal bar's close. */
  atrTimeframe?: number;
  /** Pine only: the chart's symbol, timeframe and market details. Added when a run is requested, never saved. */
  market?: PineMarket;
}

export type ExitReason = 'signal' | 'stop_loss' | 'trailing_stop' | 'take_profit' | 'end_of_data';

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
  /** Entry notional / equity at entry. Only set when the trade was sized by risk. */
  leverage?: number;
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
  /** Clock seconds of the longest drawdown stretch: its last underwater bar minus the peak bar before it. 0 when there is no drawdown. */
  maxDrawdownSeconds: number;
  exposurePct: number;
  buyHoldPct: number;
  trades: number;
  /** Entry signals that fired (see the engine); null when the strategy has no signal series (Pine). */
  signalsFired: number | null;
  /** Fired signals per 100 bars; null when unknown. */
  signalsPer100Bars: number | null;
  /** Fired signals per day (bars times the median bar length); null when unknown. */
  signalsPerDay: number | null;
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
  /** Buy and hold equity per bar (same length as `equity`), ignoring fees and slippage. */
  buyHold: number[];
  config: BacktestConfig;
  signals?: Signal[];
  /** Composed strategy only: how many entry signals the enabled filters blocked. */
  filters?: BacktestFilters;
}

export interface BacktestFilters {
  /** Fresh entry signals from the entry rule. */
  signals: number;
  /** Signals every enabled filter agreed with. */
  taken: number;
  /** Per enabled filter, signals it vetoed (a double veto counts for both). */
  blocked: Array<{
    key: 'trend' | 'volume' | 'volatility' | 'strength';
    label: string;
    blocked: number;
  }>;
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
