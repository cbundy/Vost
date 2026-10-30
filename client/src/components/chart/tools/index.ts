import { anchoredText } from './anchoredText';
import { arrow } from './arrow';
import { arrowMarkDown, arrowMarkUp } from './arrowMark';
import { arrowMarker } from './arrowMarker';
import { circle } from './circle';
import { crossLine } from './crossLine';
import { disjointChannel } from './disjointChannel';
import { flatTopBottom } from './flatTopBottom';
import { insidePitchfork, modifiedSchiffPitchfork, pitchfork, schiffPitchfork } from './pitchfork';
import { parallelChannel } from './parallelChannel';
import { regressionTrend } from './regressionTrend';
import { extendedLine } from './extendedLine';
import { horizontalRay } from './horizontalRay';
import { infoLine } from './infoLine';
import { trendAngle } from './trendAngle';
import { verticalLine } from './verticalLine';
import { fibCircles } from './fibCircles';
import { fibRetracement } from './fibRetracement';
import { fibSpeedArcs } from './fibSpeedArcs';
import { fibSpeedFan } from './fibSpeedFan';
import { fibSpiral } from './fibSpiral';
import { fibTimeZone } from './fibTimeZone';
import { horizontalLine } from './horizontalLine';
import { ray } from './ray';
import { measure } from './measure';
import { rectangle } from './rectangle';
import { text } from './text';
import { trendLine } from './trendLine';
import type { SettingField } from '../../../lib/drawingStyle';
import type { DrawingTool } from './types';

/** Every drawing tool, in rail order. A new tool adds its module (id, group, section, anchors, icon) and a line here. */
export const TOOLS: readonly DrawingTool[] = [trendLine, ray, infoLine, extendedLine, trendAngle, horizontalLine, horizontalRay, verticalLine, crossLine, parallelChannel, regressionTrend, flatTopBottom, disjointChannel, pitchfork, schiffPitchfork, modifiedSchiffPitchfork, insidePitchfork, rectangle, circle, arrow, arrowMarker, arrowMarkUp, arrowMarkDown, fibRetracement, fibTimeZone, fibSpeedFan, fibCircles, fibSpiral, fibSpeedArcs, text, anchoredText, measure];

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

/** Ids of the tools with an optional label (the stored `text` is kept when it is not empty). */
export const CAPTION_TOOLS: ReadonlySet<string> = new Set(TOOLS.filter((t) => t.caption).map((t) => t.id));

/** Ids of the tools whose anchors are fractions of the pane. */
export const PANE_TOOLS: ReadonlySet<string> = new Set(TOOLS.filter((t) => t.paneAnchored).map((t) => t.id));

/** Ids of the tools that are shown but never stored (the measure). */
export const TRANSIENT_TOOLS: ReadonlySet<string> = new Set(TOOLS.filter((t) => t.transient).map((t) => t.id));

/** The settings a stored tool declares (undefined for an unknown tool or one without settings). */
export function toolSettings(id: string): readonly SettingField[] | undefined {
  return getTool(id)?.settings;
}
