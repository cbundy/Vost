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

/** What produced the plot: plot(), hline(), bgcolor() or plotshape()/plotchar(). */
export type PinePlotKind = 'plot' | 'hline' | 'bgcolor' | 'plotshape';

export interface PinePlot {
  name: string;
  kind: PinePlotKind;
  /** Per-candle colors where they vary (e.g. bgcolor, conditional colors); same length as values. */
  colors?: (string | null)[];
  /** plotshape only: PineTS shape name (e.g. "triangle_up") and location (e.g. "BelowBar"). */
  shape?: string;
  location?: string;
  /** One value per candle (1:1); `null` where the script produced na. For bgcolor and plotshape: 1 where drawn, else null. */
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

/** Settings from the strategy() declaration (strategies only). Raw values; PineTS fills in Pine's defaults. */
export interface PineStrategyConfig {
  initialCapital: number;
  commissionType: string;
  commissionValue: number;
  defaultQtyType: string;
  defaultQtyValue: number;
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
  /** Strategies only. */
  strategyConfig?: PineStrategyConfig;
}

export interface PineError {
  message: string;
  line?: number;
  column?: number;
}

export type PineRunOutcome = PineResult | { ok: false; error: PineError };
