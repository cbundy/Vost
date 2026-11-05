/** The messages between the strategy maker page and its worker (version 1; see docs/spikes/strategy-maker, section 8). */
import type { Candle } from '../../../shared/market.ts';
import type { SeriesInput } from './engine';
import type { EngineOutcome, FindInputs, FindStage, FoundTrade } from './run';

export const PROTOCOL_VERSION = 1;

export interface TradesCandidate {
  strategyId: string;
  params: Record<string, number>;
}

export type Request =
  | { v: 1; id: string; type: 'find'; series: SeriesInput[]; inputs: FindInputs }
  | { v: 1; id: string; type: 'cancel' }
  /** The trades a candidate takes on the chart's candles (so the page thread runs no backtest). */
  | { v: 1; id: string; type: 'trades'; candles: Candle[]; candidate: TradesCandidate; inputs: Pick<FindInputs, 'direction' | 'risk'> };

export type Reply =
  | { v: 1; id: string; type: 'progress'; pct: number; stage: FindStage }
  | { v: 1; id: string; type: 'result'; outcome: EngineOutcome }
  | { v: 1; id: string; type: 'trades'; trades: FoundTrade[] }
  /** Also the answer to a cancel (with `cancelled`), which proves the worker is not stuck. */
  | { v: 1; id: string; type: 'error'; message: string; cancelled?: true };
