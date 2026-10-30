import { anchoredText } from './anchoredText';
import { table } from './table';
import { arrow } from './arrow';
import { callout } from './callout';
import { comment } from './comment';
import { anchoredNote, note } from './note';
import { priceNote } from './priceNote';
import { priceLabel } from './priceLabel';
import { signpost } from './signpost';
import { flagMark } from './flagMark';
import { image } from './image';
import { arrowMarkDown, arrowMarkUp } from './arrowMark';
import { arrowMarker } from './arrowMarker';
import { arc } from './arc';
import { circle } from './circle';
import { curve, doubleCurve } from './curve';
import { ellipse } from './ellipse';
import { rotatedRectangle } from './rotatedRectangle';
import { triangle } from './triangle';
import { crossLine } from './crossLine';
import { disjointChannel } from './disjointChannel';
import { flatTopBottom } from './flatTopBottom';
import { insidePitchfork, modifiedSchiffPitchfork, pitchfork, schiffPitchfork } from './pitchfork';
import { brush, highlighter } from './brush';
import { path, polyline } from './path';
import { parallelChannel } from './parallelChannel';
import { regressionTrend } from './regressionTrend';
import { extendedLine } from './extendedLine';
import { horizontalRay } from './horizontalRay';
import { infoLine } from './infoLine';
import { trendAngle } from './trendAngle';
import { verticalLine } from './verticalLine';
import { fibChannel } from './fibChannel';
import { fibCircles } from './fibCircles';
import { fibExtension } from './fibExtension';
import { fibRetracement } from './fibRetracement';
import { fibSpeedArcs } from './fibSpeedArcs';
import { fibSpeedFan } from './fibSpeedFan';
import { fibSpiral } from './fibSpiral';
import { fibTimeZone } from './fibTimeZone';
import { gannBox } from './gannBox';
import { gannFan } from './gannFan';
import { gannSquare } from './gannSquare';
import { gannSquareFixed } from './gannSquareFixed';
import { abcdPattern } from './abcdPattern';
import { headAndShoulders } from './headAndShoulders';
import { trianglePattern } from './trianglePattern';
import { threeDrives } from './threeDrives';
import { elliottImpulse } from './elliottImpulse';
import { elliottCorrection } from './elliottCorrection';
import { elliottTriangle } from './elliottTriangle';
import { elliottDoubleCombo } from './elliottDoubleCombo';
import { elliottTripleCombo } from './elliottTripleCombo';
import { cyclicLines } from './cyclicLines';
import { sineLine } from './sineLine';
import { timeCycles } from './timeCycles';
import { cypherPattern } from './cypherPattern';
import { xabcdPattern } from './xabcdPattern';
import { fibTrendTime } from './fibTrendTime';
import { fibWedge } from './fibWedge';
import { pitchfan } from './pitchfan';
import { horizontalLine } from './horizontalLine';
import { ray } from './ray';
import { measure } from './measure';
import { longPosition } from './longPosition';
import { shortPosition } from './shortPosition';
import { rectangle } from './rectangle';
import { text } from './text';
import { trendLine } from './trendLine';
import type { SettingField } from '../../../lib/drawingStyle';
import type { AnchorSpec, Validators } from '../../../lib/drawings';
import type { DrawingTool } from './types';

/** Every drawing tool, in rail order. A new tool adds its module (id, group, section, anchors, icon) and a line here. */
export const TOOLS: readonly DrawingTool[] = [trendLine, ray, infoLine, extendedLine, trendAngle, horizontalLine, horizontalRay, verticalLine, crossLine, parallelChannel, regressionTrend, flatTopBottom, disjointChannel, pitchfork, schiffPitchfork, modifiedSchiffPitchfork, insidePitchfork, brush, highlighter, rectangle, circle, arrow, arrowMarker, arrowMarkUp, arrowMarkDown, path, polyline, rotatedRectangle, ellipse, triangle, arc, curve, doubleCurve, fibRetracement, fibExtension, fibChannel, fibTimeZone, fibSpeedFan, fibTrendTime, fibCircles, fibSpiral, fibSpeedArcs, fibWedge, pitchfan, gannBox, gannSquareFixed, gannSquare, gannFan, xabcdPattern, cypherPattern, abcdPattern, headAndShoulders, trianglePattern, threeDrives, elliottImpulse, elliottCorrection, elliottTriangle, elliottDoubleCombo, elliottTripleCombo, cyclicLines, timeCycles, sineLine, text, anchoredText, table, note, anchoredNote, priceNote, callout, comment, priceLabel, signpost, flagMark, image, longPosition, shortPosition, measure];

export function getTool(id: string): DrawingTool | undefined {
  return TOOLS.find((t) => t.id === id);
}

export type { DrawingGroup, DrawingTool } from './types';
export { anchorRange } from '../../../lib/drawings';

/** Anchors each tool needs, for validating stored drawings. */
export const ANCHOR_COUNTS: Readonly<Record<string, AnchorSpec>> = Object.fromEntries(
  TOOLS.filter((t) => !t.transient).map((t) => [t.id, t.anchors]),
);

/** Ids of the tools that store text. */
export const TEXT_TOOLS: ReadonlySet<string> = new Set(TOOLS.filter((t) => t.text).map((t) => t.id));

/** Ids of the tools whose content is a grid of cells. */
export const CELL_TOOLS: ReadonlySet<string> = new Set(TOOLS.filter((t) => t.cells).map((t) => t.id));

/** The load checks of the tools that have one, by tool id. */
export const VALIDATORS: Validators = Object.fromEntries(TOOLS.flatMap((t) => (t.validate ? [[t.id, t.validate.bind(t)]] : [])));

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
