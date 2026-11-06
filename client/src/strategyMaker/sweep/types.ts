/** Types of the market search (the sweep): many markets and timeframes, a grid of signal settings and exits. */
import type { Interval } from '../../../../shared/market.ts';
import type { SweepParam } from '../../lib/backtest/optimizer';
import type { Candle } from '../../types';
import type { CandidateStats, Gap, SearchDirection, Targets } from '../engine/types';

/** One set of conditions that must all hold; a candidate passes when it meets any one set. */
export type TargetSet = Targets;

export interface SweepMarket {
  provider: string;
  symbol: string;
}

/** Stops are `stopMults` times the typical bar range (percent of close); take profits are `tpMults` times the stop. */
export interface ExitGrid {
  stopMults: number[];
  tpMults: number[];
}

export interface SweepRisk {
  initialCapital: number;
  /** Percent of equity lost when the stop is hit (no leverage cap). */
  riskPct: number;
  feeBps: number;
  slippageBps: number;
}

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
}

export interface SweepCandidate {
  market: SweepMarket;
  timeframe: Interval;
  strategyId: string;
  params: Record<string, number>;
  /** The exit used, in percent of entry price. */
  stopLossPct: number;
  takeProfitPct: number;
  /** Index into `targetSets` of the set it met. */
  setIndex: number;
  held: boolean;
  selection: PartFigures;
  heldOut: PartFigures;
}

export interface ClosestCandidate {
  market: SweepMarket;
  timeframe: Interval;
  strategyId: string;
  params: Record<string, number>;
  stopLossPct: number;
  takeProfitPct: number;
  /** The nearest set and the gaps of the selection figures against it. */
  setIndex: number;
  gaps: Gap[];
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
}
