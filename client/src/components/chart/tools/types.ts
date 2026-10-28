import type { ReactNode } from 'react';
import type { Pt } from '../../../lib/drawingGeometry';

export type ToolRenderOpts = { width: number; selected: boolean };

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
  draw(ctx: CanvasRenderingContext2D, pts: Pt[], opts: ToolRenderOpts): void;
  /** Whether a press at p grabs the drawing's body. */
  hit(pts: Pt[], p: Pt, width: number, tolerance?: number): boolean;
  /** Where the selection handles go. */
  handles(pts: Pt[], width: number): Pt[];
}
