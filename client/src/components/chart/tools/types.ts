import type { ReactNode } from 'react';
import type { Pt } from '../../../lib/drawingGeometry';
import type { SettingField } from '../../../lib/drawingStyle';
import type { Anchor } from '../../../lib/drawings';

export type ToolRenderOpts = { selected: boolean };

/** What a tool may know about the chart besides its anchors' pixels. */
export interface ToolView {
  /** Pane size in pixels. */
  width: number;
  height: number;
  /** The drawing's anchors (time and price), in the same order as its pixel points. */
  anchors: readonly Anchor[];
  /** The drawing's text; empty for tools without text. */
  text: string;
  /** Times of the loaded bars, ascending. */
  times: readonly number[];
  /** Pixel y of a price, or null when it is off the scale. */
  priceToY(price: number): number | null;
  /** A price as the series formats it. */
  formatPrice(price: number): string;
  /** The drawing's effective style: every setting of the tool with its validated value. */
  style: Readonly<Record<string, unknown>>;
  /** The drawing (or the user's default for its tool) sets a style value of its own; false keeps today's selection colour. */
  styled: boolean;
}

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
  /** Anchors the tool needs before it is finished. */
  anchors: number;
  /** The tool stores text (a note). */
  text?: true;
  /** The tool is shown while and after it is drawn but never stored, hit or undone (the measure). */
  transient?: true;
  /**
   * The style settings the dialog offers, with their defaults. A tool that is stored declares them; the
   * visibility settings every drawing has are added to them.
   */
  settings?: readonly SettingField[];
  /** A drag moves it vertically only (the time of its anchor is kept). */
  priceOnly?: boolean;
  draw(ctx: CanvasRenderingContext2D, pts: Pt[], view: ToolView, opts: ToolRenderOpts): void;
  /** Whether a press at p grabs the drawing's body. */
  hit(pts: Pt[], p: Pt, view: ToolView, tolerance?: number): boolean;
  /** Where the selection handles go. */
  handles(pts: Pt[], view: ToolView): Pt[];
  /**
   * The new anchor pixels when handle `handle` is dragged to p. Absent: handle i moves anchor i.
   */
  dragHandle?(origPts: Pt[], handle: number, p: Pt): Pt[];
}
