import type { ReactNode } from 'react';
import type { Pt } from '../../../lib/drawingGeometry';
import type { Anchor } from '../../../lib/drawings';

export type ToolRenderOpts = { selected: boolean };

/** What a tool may know about the chart besides its anchors' pixels. */
export interface ToolView {
  /** Pane size in pixels. */
  width: number;
  height: number;
  /** The drawing's anchors (time and price), in the same order as its pixel points. */
  anchors: readonly Anchor[];
  /** Pixel y of a price, or null when it is off the scale. */
  priceToY(price: number): number | null;
  /** A price as the series formats it. */
  formatPrice(price: number): string;
}

/** One drawing tool. Geometry is in chart pixels (the anchors are already converted). */
export interface DrawingTool {
  id: string;
  label: string;
  /** The rail button's icon. */
  icon: ReactNode;
  /** Anchors the tool needs before it is finished. */
  anchors: number;
  /** A drag moves it vertically only (the time of its anchor is kept). */
  priceOnly?: boolean;
  draw(ctx: CanvasRenderingContext2D, pts: Pt[], view: ToolView, opts: ToolRenderOpts): void;
  /** Whether a press at p grabs the drawing's body. */
  hit(pts: Pt[], p: Pt, view: ToolView): boolean;
  /** Where the selection handles go. */
  handles(pts: Pt[], view: ToolView): Pt[];
  /**
   * The new anchor pixels when handle `handle` is dragged to p. Absent: handle i moves anchor i.
   */
  dragHandle?(origPts: Pt[], handle: number, p: Pt): Pt[];
}
