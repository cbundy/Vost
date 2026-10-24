/** Result types of the Pine runtime (PineTS). Pure data, safe to post from a worker. */
export type PineKind = 'indicator' | 'strategy';

export interface PineDeclaration {
  title: string;
  overlay: boolean;
}

export type PineInputValue = number | boolean | string;

export interface PineInput {
  name: string;
  type: string;
  defval: PineInputValue | null;
  minval?: number;
  maxval?: number;
  step?: number;
  options?: PineInputValue[];
}

export type PinePlotPane = 'price' | 'separate';

export interface PinePlot {
  name: string;
  /** One value per candle (1:1); `null` where the script produced na. */
  values: (number | null)[];
  color: string | null;
  style: string;
  pane: PinePlotPane;
}

export interface PineTrade {
  id: string;
  direction: 'long' | 'short';
  size: number;
  /** Candle indices into the input array. */
  entryIndex: number;
  /** Null while the trade is still open at the last bar. */
  exitIndex: number | null;
  /** Candle times, in seconds. */
  entryTime: number;
  exitTime: number | null;
  entryPrice: number;
  exitPrice: number | null;
  profit: number | null;
  exitId: string | null;
}

export interface PineResult {
  ok: true;
  kind: PineKind;
  declaration: PineDeclaration;
  inputs: PineInput[];
  plots: PinePlot[];
  /** Strategies only: closed and still-open trades. */
  trades: PineTrade[];
  /** Strategies only: signed position size at the close of each candle. */
  position: number[];
}

export interface PineError {
  message: string;
  line?: number;
  column?: number;
}

export type PineRunOutcome = PineResult | { ok: false; error: PineError };
