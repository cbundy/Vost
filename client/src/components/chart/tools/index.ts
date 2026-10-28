import { horizontalLine } from './horizontalLine';
import { trendLine } from './trendLine';
import type { DrawingTool } from './types';

/** Every drawing tool, in rail order. A new tool adds its module (id, anchors, icon) and a line here. */
export const TOOLS: readonly DrawingTool[] = [trendLine, horizontalLine];

export function getTool(id: string): DrawingTool | undefined {
  return TOOLS.find((t) => t.id === id);
}

export type { DrawingTool } from './types';

/** Anchors each tool needs, for validating stored drawings. */
export const ANCHOR_COUNTS: Readonly<Record<string, number>> = Object.fromEntries(TOOLS.map((t) => [t.id, t.anchors]));
