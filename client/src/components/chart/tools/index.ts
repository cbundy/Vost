import { crossLine } from './crossLine';
import { extendedLine } from './extendedLine';
import { horizontalRay } from './horizontalRay';
import { infoLine } from './infoLine';
import { trendAngle } from './trendAngle';
import { verticalLine } from './verticalLine';
import { fibRetracement } from './fibRetracement';
import { horizontalLine } from './horizontalLine';
import { ray } from './ray';
import { measure } from './measure';
import { rectangle } from './rectangle';
import { text } from './text';
import { trendLine } from './trendLine';
import type { SettingField } from '../../../lib/drawingStyle';
import type { DrawingTool } from './types';

/** Every drawing tool, in rail order. A new tool adds its module (id, group, section, anchors, icon) and a line here. */
export const TOOLS: readonly DrawingTool[] = [trendLine, ray, infoLine, extendedLine, trendAngle, horizontalLine, horizontalRay, verticalLine, crossLine, rectangle, fibRetracement, text, measure];

export function getTool(id: string): DrawingTool | undefined {
  return TOOLS.find((t) => t.id === id);
}

export type { DrawingGroup, DrawingTool } from './types';

/** Anchors each tool needs, for validating stored drawings. */
export const ANCHOR_COUNTS: Readonly<Record<string, number>> = Object.fromEntries(
  TOOLS.filter((t) => !t.transient).map((t) => [t.id, t.anchors]),
);

/** Ids of the tools that store text. */
export const TEXT_TOOLS: ReadonlySet<string> = new Set(TOOLS.filter((t) => t.text).map((t) => t.id));

/** Ids of the tools that are shown but never stored (the measure). */
export const TRANSIENT_TOOLS: ReadonlySet<string> = new Set(TOOLS.filter((t) => t.transient).map((t) => t.id));

/** The settings a stored tool declares (undefined for an unknown tool or one without settings). */
export function toolSettings(id: string): readonly SettingField[] | undefined {
  return getTool(id)?.settings;
}
