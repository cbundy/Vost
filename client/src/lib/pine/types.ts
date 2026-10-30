/** Result types of the Pine runtime (PineTS). Pure data, safe to post from a worker. */
/** The market a script runs in: what `syminfo` and `timeframe` report. Added to a request by the chart, never saved. */
export interface PineMarket {
  /** Provider id (`binance`, `yahoo`...) or an imported dataset's source. Upper-cased it is `syminfo.prefix`. */
  providerId: string;
  symbol: string;
  /** The chart's interval (`1h`, `2h`, `3d`...). */
  interval?: string;
  /** Bar length in seconds, for a dataset with no named interval. */
  barSeconds?: number;
  /** An imported dataset is shown: `syminfo.type` is empty. */
  dataset?: boolean;
  /** `built` when the chart's Build setting is on: other timeframes are asked for built the same way. */
  source?: 'built';
}

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

/** What produced the plot: plot(), hline(), bgcolor(), plotshape()/plotchar(), fill(), plotcandle(), plotbar(), barcolor() or plotarrow(). */
export type PinePlotKind = 'plot' | 'hline' | 'bgcolor' | 'plotshape' | 'fill' | 'candle' | 'bar' | 'barcolor' | 'plotarrow';

export interface PinePlot {
  name: string;
  kind: PinePlotKind;
  /** Per-candle colors where they vary (e.g. bgcolor, conditional colors); same length as values. */
  colors?: (string | null)[];
  /** plotshape only: PineTS shape name (e.g. "triangle_up") and location (e.g. "BelowBar"). */
  shape?: string;
  location?: string;
  /** plotshape/plotchar: the `text` option (plot-level) and per-candle texts where they vary; the `size` option (`tiny`..`huge`, `auto`). */
  text?: string;
  texts?: (string | null)[];
  size?: string;
  /** plotchar only: the character drawn (Pine's default is a star). */
  char?: string;
  /** plot/hline `linewidth` option; absent when the script gave none. */
  lineWidth?: number;
  /** The `offset` option, already applied to the per-candle arrays; kept for information. */
  offset?: number;
  /** area/columns/histogram `histbase` option. */
  histbase?: number;
  /** hline `linestyle` option. */
  lineStyle?: 'solid' | 'dashed' | 'dotted';
  /** fill only: indices into `plots` of the two plots it joins; `values` are all null, `colors` hold the area colour. */
  plot1?: number;
  plot2?: number;
  /** candle/bar only: [open, high, low, close] per candle (1:1); null when any of the four is na. `values` holds the close. */
  ohlc?: ([number, number, number, number] | null)[];
  /** candle only: per-candle wick and border colors (null = the body color). */
  wickColors?: (string | null)[];
  borderColors?: (string | null)[];
  /** plotarrow only: `minheight`/`maxheight` options of the call (Pine defaults 5 and 100). */
  minHeight?: number;
  maxHeight?: number;
  /** One value per candle (1:1); `null` where the script produced na. For bgcolor and plotshape: 1 where drawn, else null. For barcolor: 1 where colored. For plotarrow: the signed number. */
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
  /** Alerts, alert conditions and log lines the script produced. */
  messages?: PineMessages;
  /** The line, box, polyline and linefill objects the script left, in their final state. Absent when there are none. */
  drawings?: PineDrawings;
}

/** Where a drawing object is painted: over the candles, or in the script's own pane. */
export type PineDrawingPane = 'price' | 'separate';
export type PineDrawingStyle = 'solid' | 'dashed' | 'dotted';
export type PineExtend = 'none' | 'l' | 'r' | 'b';

/** A `line` object. Times are unix seconds; a colour is `#RRGGBB` or `#RRGGBBAA`, null for na (not drawn). */
export interface PineLine {
  pane: PineDrawingPane;
  time1: number;
  price1: number;
  time2: number;
  price2: number;
  extend: PineExtend;
  color: string | null;
  style: PineDrawingStyle;
  /** Which ends carry an arrow head. */
  arrows: 'none' | 'left' | 'right' | 'both';
  width: number;
}

export interface PineBox {
  pane: PineDrawingPane;
  time1: number;
  top: number;
  time2: number;
  bottom: number;
  extend: PineExtend;
  borderColor: string | null;
  borderStyle: PineDrawingStyle;
  borderWidth: number;
  bgColor: string | null;
  text: string;
  textColor: string | null;
  /** Text size in px. */
  textSize: number;
  halign: 'left' | 'center' | 'right';
  valign: 'top' | 'center' | 'bottom';
  /** Whether the text wraps to the box width. */
  wrap: boolean;
}

export interface PinePolyline {
  pane: PineDrawingPane;
  points: { time: number; price: number }[];
  curved: boolean;
  closed: boolean;
  lineColor: string | null;
  fillColor: string | null;
  style: PineDrawingStyle;
  width: number;
}

/** The area between two lines' drawn spans. */
export interface PineLinefill {
  pane: PineDrawingPane;
  line1: PineLine;
  line2: PineLine;
  color: string | null;
}

export interface PineDrawings {
  lines: PineLine[];
  boxes: PineBox[];
  polylines: PinePolyline[];
  linefills: PineLinefill[];
}

export interface PineError {
  message: string;
  line?: number;
  column?: number;
  /** The `user/name/version` of an imported library that could not be loaded. */
  library?: string;
}

export type PineRunOutcome = PineResult | { ok: false; error: PineError };

export interface PineAlert {
  /** Bar open time, seconds. */
  time: number;
  message: string;
  frequency: string;
}

export interface PineAlertCondition {
  title: string;
  message: string;
  /** Bars where the condition was true (all of them, even past the cap on `times`). */
  count: number;
  /** Bar open times (seconds) where it was true, newest kept when capped. */
  times: number[];
}

export interface PineLog {
  time: number;
  level: 'info' | 'warning' | 'error';
  text: string;
}

/** What a script said during a run: alerts, alert conditions and log lines. Display only. */
export interface PineMessages {
  alerts: PineAlert[];
  alertConditions: PineAlertCondition[];
  logs: PineLog[];
  /** How many entries each list dropped for the cap. */
  omitted: { alerts: number; conditionTimes: number; logs: number };
}
