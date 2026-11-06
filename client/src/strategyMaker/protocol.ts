/** The messages between the strategy maker page and its worker (version 1; see docs/spikes/strategy-maker, section 8). */
import type { Candle } from '../../../shared/market.ts';
import type { SeriesInput, TrainResult } from './engine';
import type { SweepInput, SweepProgress, SweepResult } from './sweep/types';
import type { EngineOutcome, FindInputs, FindStage, FoundTrade, TrainedOutcome } from './run';

export const PROTOCOL_VERSION = 1;

export interface TradesCandidate {
  strategyId: string;
  params: Record<string, number>;
}

export type Request =
  /** With `model`, an up-to-date model for these series (in its training order), the run skips training. */
  | { v: 1; id: string; type: 'find'; series: SeriesInput[]; inputs: FindInputs; model?: TrainResult }
  /** Training alone; the answer is a `result` with a `trained`, `too-few` or `refused` outcome. */
  | { v: 1; id: string; type: 'train'; series: SeriesInput[] }
  | { v: 1; id: string; type: 'cancel' }
  /** The market search; the worker loads the candles itself. */
  | { v: 1; id: string; type: 'sweep'; input: SweepInput }
  /** The trades a candidate takes on the chart's candles (so the page thread runs no backtest). */
  | { v: 1; id: string; type: 'trades'; candles: Candle[]; candidate: TradesCandidate; inputs: Pick<FindInputs, 'direction' | 'risk'> };

export type Reply =
  | { v: 1; id: string; type: 'progress'; pct: number; stage: FindStage }
  | { v: 1; id: string; type: 'result'; outcome: EngineOutcome | TrainedOutcome }
  | { v: 1; id: string; type: 'sweep-progress'; progress: SweepProgress }
  | { v: 1; id: string; type: 'sweep-result'; result: SweepResult }
  | { v: 1; id: string; type: 'trades'; trades: FoundTrade[] }
  /** Also the answer to a cancel (with `cancelled`), which proves the worker is not stuck. */
  | { v: 1; id: string; type: 'error'; message: string; cancelled?: true };
