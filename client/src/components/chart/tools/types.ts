import type { ReactNode } from 'react';
import type { OhlcBar, Pt } from '../../../lib/drawingGeometry';
import type { SettingField } from '../../../lib/drawingStyle';
import type { Anchor, AnchorSpec, Drawing } from '../../../lib/drawings';

export type ToolRenderOpts = { selected: boolean };

export type AxisLabels = { price?: readonly number[]; time?: readonly number[] };

/** What a tool may know about the chart besides its anchors' pixels. */
export interface ToolView {
  /** Pane size in pixels. */
  width: number;
  height: number;
  /** The drawing's anchors (time and price), in the same order as its pixel points. */
  anchors: readonly Anchor[];
  /** The drawing's text; empty for tools without text. */
  text: string;
  /** The drawing's cells (a table); empty for tools without cells. */
  cells: readonly (readonly string[])[];
  /** The drawing's picture (an image); absent for tools without one. */
  image?: { key: string; w: number; h: number };
  /** Times of the loaded bars, ascending. */
  times: readonly number[];
  /** The loaded bars (open, high, low, close), ascending by time. */
  candles: readonly OhlcBar[];
  /** Pixel y of a price, or null when it is off the scale. */
  priceToY(price: number): number | null;
  /** A price as the series formats it. */
  formatPrice(price: number): string;
  /** The drawing's effective style: every setting of the tool with its validated value. */
  style: Readonly<Record<string, unknown>>;
  /** The drawing (or the user's default for its tool) sets a style value of its own; false keeps today's selection colour. */
  styled: boolean;
}

/** What a handle drag may know besides the pointer: the Shift key (desktop) and the drawing's effective style. */
export type DragMods = { shift: boolean; style?: Readonly<Record<string, unknown>> };

/** The rail's tool families, in rail order (see lib/drawingRail.ts for labels). */
export type DrawingGroup = 'cursors' | 'lines' | 'fib-gann' | 'patterns' | 'forecast-measure' | 'shapes' | 'annotations' | 'icons';

/** One drawing tool. Geometry is in chart pixels (the anchors are already converted). */
export interface DrawingTool {
  id: string;
  label: string;
  /** The family the tool belongs to in the rail. */
  group: DrawingGroup;
  /** The heading inside the family's flyout (for example "Lines", "Fibonacci"). */
  section: string;
  /** The rail button's icon. */
  icon: ReactNode;
  /**
   * Anchors the tool needs before it is finished: a count, or a `{ min, max }` range for a tool placed point by point
   * (ended by double-click, Enter or a click on its first point). Use `anchorRange` to read either.
   */
  anchors: AnchorSpec;
  /**
   * The tool is drawn freehand: press, drag and release records a stroke (thinned on release) and never enters
   * click-by-click placement, whatever its anchor range says.
   */
  freehand?: true;
  /**
   * How many points the user places before the drawing is finished, when that is fewer than it stores (a curve is
   * placed by its start and end and `settle` adds its control points). Absent: the same as `anchors`.
   */
  placed?: AnchorSpec;
  /** The tool stores text (a note). */
  text?: true;
  /** The tool's content is a grid of text cells, stored as the drawing's `cells` (a table); the cell editor opens for it. */
  cells?: true;
  /**
   * A check run on a stored drawing of this tool when it is loaded, after the generic ones: the drawing as it should
   * be kept (a fixed copy), or null to drop it alone.
   */
  validate?(d: Drawing): Drawing | null;
  /**
   * The tool carries an optional label: it is set on the settings dialog's Text tab (never by the note editor),
   * may be empty and is stored as the drawing's `text`.
   */
  caption?: true;
  /** The anchor's time is always a whole bar's time (a whole future bar slot past the last bar), whatever the magnet says. */
  barTime?: true;
  /**
   * The drawing is fixed on the pane: each anchor stores its x and y as fractions of the pane (0..1) in the anchor's
   * `time` and `price`, so it ignores the time range, zoom, pan and timeframe. No magnet and no axis labels.
   */
  paneAnchored?: true;
  /** The tool is shown while and after it is drawn but never stored, hit or undone (the measure). */
  transient?: true;
  /**
   * The style settings the dialog offers, with their defaults. A tool that is stored declares them; the
   * visibility settings every drawing has are added to them.
   */
  settings?: readonly SettingField[];
  /** A drag moves it vertically only (the time of its anchor is kept). */
  priceOnly?: boolean;
  /** A drag moves it horizontally only (the price of its anchor is kept): the vertical line. */
  timeOnly?: boolean;
  /** The drawing spans the pane's width (or height), so it places and hits even when its anchor is off the scale on that axis. */
  fullWidth?: boolean;
  fullHeight?: boolean;
  /**
   * The labels the drawing shows on the axes: prices on the price axis, times on the time axis. Absent: none.
   * Called for every drawing, so a tool that labels only while selected returns nothing otherwise. `times` are the
   * loaded bars' times, for a tool whose labels are not at its anchors.
   */
  axisLabels?(anchors: readonly Anchor[], style: Readonly<Record<string, unknown>>, selected: boolean, times?: readonly number[]): AxisLabels;
  /**
   * While a drawing with more than two anchors is placed, `pts` holds fewer points than `anchors` (the placed ones
   * and the moving one; a ranged tool holds anywhere from two up to its max): draw what can be drawn, never throw.
   */
  draw(ctx: CanvasRenderingContext2D, pts: Pt[], view: ToolView, opts: ToolRenderOpts): void;
  /** Whether a press at p grabs the drawing's body. */
  hit(pts: Pt[], p: Pt, view: ToolView, tolerance?: number): boolean;
  /**
   * Painted on top of every drawing while the drawing is hovered, selected or pinned open (a note's text popup).
   * `view` has the pane size, for keeping the popup inside it.
   */
  popup?(ctx: CanvasRenderingContext2D, pts: Pt[], view: ToolView): void;
  /** Whether a press at p is on the open popup, so a pinned popup can be pressed (it selects the drawing). */
  popupHit?(pts: Pt[], p: Pt, view: ToolView, tolerance?: number): boolean;
  /** Where the selection handles go. */
  handles(pts: Pt[], view: ToolView): Pt[];
  /** Adjusts the pixels of a drawing once, when its last anchor is placed (the fixed Gann square makes itself square). It may return more points than were placed (a curve adds its control points). */
  settle?(pts: Pt[]): Pt[];
  /**
   * The new anchor pixels when handle `handle` is dragged to p. Absent: handle i moves anchor i.
   */
  dragHandle?(origPts: Pt[], handle: number, p: Pt, mods?: DragMods): Pt[];
}
