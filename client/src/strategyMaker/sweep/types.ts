/** Types of the market search (the sweep): many markets and timeframes, a grid of signal settings and exits. */
import type { Interval } from '../../../../shared/market.ts';
import type { BacktestConfig } from '../../lib/backtest/types';
import type { SweepParam } from '../../lib/backtest/optimizer';
import type { PineRole } from '../../lib/backtest/pineRole';
import type { Candle } from '../../types';
import type { CandidateStats, Gap, SearchDirection, Targets } from '../engine/types';

/** One set of conditions that must all hold; a candidate passes when it meets any one set. */
export type TargetSet = Targets;

export interface SweepMarket {
  provider: string;
  symbol: string;
}

/** How an exit is placed: a stop sized by the typical bar range, by the ATR, or an ATR trailing stop. */
export type ExitKind = 'range' | 'atr' | 'atr_trail';

/** Stops are `stopMults` times the typical bar range (percent of close) or the ATR; take profits are `tpMults` times the stop. */
export interface ExitGrid {
  stopMults: number[];
  tpMults: number[];
  /** The kinds to try; absent or empty reads as `['range']`. */
  kinds?: ExitKind[];
}

/** One exit the search tries, with the backtest settings it sets. */
export interface SweepExit {
  kind: ExitKind;
  stopMult: number;
  tpMult: number;
  config: Partial<BacktestConfig>;
}

export interface SweepRisk {
  initialCapital: number;
  /** Percent of equity lost when the stop is hit (no leverage cap). */
  riskPct: number;
  feeBps: number;
  slippageBps: number;
}

/** The Composed strategy in the search: entry rules (1-6) crossed with filters off and on, with trend multiples of the loaded bars. */
export interface SweepComposed {
  entryRules: number[];
  filters: Array<'trend' | 'volume' | 'atr' | 'adx'>;
  /** Multiples of the loaded bars for the trend filter; 1 is always tried. */
  trendTfs: number[];
  /** Stored TradingView indicators tried as an entry rule (7) or as a filter. Absent reads as none. */
  pine?: SweepPineRole[];
  /** The indicators' sources by `indicatorId`, attached to a request when Run is pressed. Never in a result, a record or a link. */
  pineSources?: Record<string, string>;
}

/** A number input of an indicator stepped over a range. `min` and `max` are the input's own bounds, when it has them. */
export interface SweepPineRange {
  input: string;
  from: number;
  to: number;
  step: number;
  min?: number;
  max?: number;
  /** The input is an integer: the range must be whole numbers. */
  int?: boolean;
}

/** One stored indicator as an entry rule or a filter, with the number inputs to search. */
export interface SweepPineRole {
  role: Omit<PineRole, 'source'>;
  ranges: SweepPineRange[];
}

/** What the unseen part must also beat: nothing, buy and hold's return, or its return over drawdown. */
export type BeatBuyHold = 'off' | 'return' | 'return_dd';

export interface SweepInput {
  markets: SweepMarket[];
  timeframes: Interval[];
  families: string[];
  direction: SearchDirection;
  /** 1 to 4 sets. */
  targetSets: TargetSet[];
  risk: SweepRisk;
  exits: ExitGrid;
  /** Per family, the ranges to search; a family without an entry uses the default grid. */
  space?: Record<string, SweepParam[]>;
  /** Composed strategies (entry rule plus filters). Absent, or without an entry rule, adds none. */
  composed?: SweepComposed;
  /** A result counts as held only if it also beats buy and hold on the hold-out. Absent reads as off. */
  beatBuyHold?: BeatBuyHold;
  /** Also search shuffled copies of the same markets and count what chance gives. */
  baseline?: boolean;
}

/** Loads the candles of a market and timeframe, or throws. */
export type SweepLoad = (market: SweepMarket, timeframe: Interval, signal?: AbortSignal) => Promise<Candle[]>;

export interface SweepProgress {
  /** 0..1, never decreasing. */
  pct: number;
  /** Market and timeframe being worked on. */
  label: string;
}

export interface PartFigures extends CandidateStats {
  finalEquity: number;
  /** Buy and hold of the part: first close to last close, in percent. Absent in an older result. */
  buyHoldPct?: number;
  /** The largest fall from a peak of the closes of the part, positive percent. Absent in an older result. */
  buyHoldDrawdownPct?: number;
}

export interface SweepCandidate {
  market: SweepMarket;
  timeframe: Interval;
  strategyId: string;
  params: Record<string, number>;
  /** The exit used. Absent in a result stored before exit kinds existed: read it with `exitOfCandidate`. */
  exit?: SweepExit;
  /** The exit in percent of entry price; null for the ATR kinds. */
  stopLossPct: number | null;
  takeProfitPct: number | null;
  /** Index into `targetSets` of the set it met. */
  setIndex: number;
  held: boolean;
  /** The TradingView indicator roles of a Composed setting, with their input values and no source. Absent in an older result. */
  pineRoles?: PineRole[];
  selection: PartFigures;
  heldOut: PartFigures;
}

export interface ClosestCandidate {
  market: SweepMarket;
  timeframe: Interval;
  strategyId: string;
  params: Record<string, number>;
  exit?: SweepExit;
  stopLossPct: number | null;
  takeProfitPct: number | null;
  /** The nearest set and the gaps of the selection figures against it. */
  setIndex: number;
  gaps: Gap[];
  pineRoles?: PineRole[];
  selection: PartFigures;
}

export interface SkippedSeries {
  market: SweepMarket;
  timeframe: Interval;
  reason: string;
}

export interface SweepResult {
  /** Held first, then by final equity (hold-out for held ones, selection otherwise). */
  candidates: SweepCandidate[];
  /** Markets and timeframes where nothing met a set. */
  closest: ClosestCandidate[];
  skipped: SkippedSeries[];
  tried: number;
  met: number;
  held: number;
  /** What shuffled copies of the same markets gave (counts only). Absent when the baseline was off. */
  baseline?: { series: number; tried: number; met: number; held: number };
}
