/** Types of the strategy maker's search engine: inputs, results, targets and gaps. */
import type { SweepParam } from '../../lib/backtest/optimizer';
import type { BacktestConfig } from '../../lib/backtest/types';
import type { Candle } from '../../types';

/** Fewest highlighted trades (across all series) before the engine recommends anything. */
export const MIN_TRADES = 30;

/** The built-in strategies that are plain signal templates; the only ids the engine accepts. */
export const SIGNAL_FAMILIES = ['sma_cross', 'ema_cross', 'macd_cross', 'rsi_reversion', 'bollinger', 'donchian', 'composed', 'pullback', 'reversal', 'momentum_breakout'] as const;

export type SearchDirection = 'long' | 'short' | 'both';

/** A trade the user highlighted. Times are unix seconds. */
export interface HighlightTrade {
  side: 'long' | 'short';
  entryTime: number;
  exitTime: number;
}

export interface SeriesInput {
  candles: Candle[];
  trades: HighlightTrade[];
}

export interface Targets {
  /** Average win over average loss, at least. */
  minRR?: number;
  /** Share of winning trades in percent, at least. */
  minHitRatePct?: number;
  /** Largest drawdown in percent (positive), at most. */
  maxDrawdownPct?: number;
}

export type RiskInput = Partial<
  Pick<BacktestConfig, 'initialCapital' | 'positionSizePct' | 'riskPct' | 'feeBps' | 'slippageBps' | 'stopLossPct' | 'takeProfitPct'>
  & Pick<
    BacktestConfig,
    'stopMode' | 'stopAtrMult' | 'takeProfitMode' | 'takeProfitAtrMult' | 'takeProfitR' | 'trailMode' | 'trailPct' | 'trailAtrMult' | 'atrLength'
  >
>;

export interface SearchInput {
  series: SeriesInput[];
  targets: Targets;
  direction: SearchDirection;
  /** Defaults to SIGNAL_FAMILIES. */
  families?: string[];
  risk?: RiskInput;
  /** Per family, the ranges to search. A family without an entry uses the default grid. */
  space?: Record<string, SweepParam[]>;
  /** Bars within which a found entry or exit counts as the highlighted one. Default 3. */
  tolerance?: number;
  /** How many best matches are backtested. Default 8. */
  topN?: number;
  signal?: AbortSignal;
  /** `pct` is 0..1 and never decreases. */
  onProgress?: (pct: number, stage: SearchStage) => void;
}

export type SearchStage = 'scoring' | 'backtesting' | 'validating' | 'done';

export interface SkippedTrade {
  /** Index of the series. */
  series: number;
  /** Index of the trade in that series' list. */
  index: number;
  reason: string;
}

export interface MatchScore {
  f1: number;
  precision: number;
  recall: number;
}

export interface CandidateStats {
  trades: number;
  /** Entry signals that fired over the parts that ran (see the engine); null when no part ran. */
  signalsFired: number | null;
  /** Fired per 100 bars, pooled over the parts; null when no part ran. */
  signalsPer100Bars: number | null;
  /** Fired per day, pooled over the parts; null when no part ran. */
  signalsPerDay: number | null;
  totalReturnPct: number;
  /** Null without trades. */
  winRatePct: number | null;
  /** Average win over average loss; null when there is no loss or no trade. */
  rr: number | null;
  /** Positive percent. */
  maxDrawdownPct: number;
}

export interface Gap {
  metric: keyof Targets;
  actual: number | null;
  target: number;
  /** For example `maxDrawdownPct 73.2 > 60`. */
  text: string;
}

export interface Candidate {
  strategyId: string;
  params: Record<string, number>;
  /** How well its entries and exits reproduce the highlights, on the selection part. */
  match: MatchScore;
  /** Backtest on the first 70% of each series (where it was chosen). */
  selection: CandidateStats;
  /** Backtest on the last 30% of each series (not used to choose). */
  heldOut: CandidateStats;
  /** What the selection backtest misses the targets by; empty when it meets them. */
  gaps: Gap[];
  meetsTargets: boolean;
}

export interface ValidationCheck {
  id: 'held-out' | 'walk-forward' | 'robustness' | 'monte-carlo';
  passed: boolean;
  detail: string;
}

export interface Validation {
  candidate: Candidate;
  /** Held-out gaps against the targets. */
  heldOutGaps: Gap[];
  checks: ValidationCheck[];
  /** True only when the held-out result keeps R:R, hit rate and drawdown within the targets. */
  validated: boolean;
}

export interface SearchResult {
  kind: 'ok';
  /** Candidates meeting the targets first, then by match; at most topN. */
  recommendations: Candidate[];
  bestMatch: Candidate;
  bestMeetingTargets: Candidate | null;
  /** When none meets the targets: the nearest one, with its gaps. */
  closest: Candidate | null;
  validation: Validation;
  skipped: SkippedTrade[];
  /** Trades used for scoring, across all series. */
  usedTrades: number;
  /** Candidates scored per series. */
  candidates: number;
}

export type SearchOutcome =
  SearchResult | { kind: 'too-few'; have: number; need: number; skipped: SkippedTrade[] } | { kind: 'refused'; reason: string };
