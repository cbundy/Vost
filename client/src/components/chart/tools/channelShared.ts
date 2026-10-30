import { HIT_TOLERANCE, distToSegment, type Pt } from '../../../lib/drawingGeometry';
import { cssColor, type SettingField } from '../../../lib/drawingStyle';
import { pointInPolygon } from '../../../lib/geometry/channels';
import { boolField, colorField, lineStyleField, opacityField, widthField } from './fields';
import type { AxisLabels } from './types';

/** The settings the channel tools share: the lines' colour, width and style, and the fill between them. */
export function channelSettings(extend: boolean, extra: SettingField[] = []): SettingField[] {
  return [
    colorField('color', 'Line colour', 'accent'),
    widthField('width', 'Line width', 1.5),
    lineStyleField('lineStyle', 'Line style'),
    colorField('fillColor', 'Fill colour', 'accent'),
    opacityField('fillOpacity', 'Fill opacity', 0.1),
    ...extra,
    ...(extend ? [boolField('extendLeft', 'Extend left', false), boolField('extendRight', 'Extend right', false)] : []),
  ];
}

/** The labels of a selected channel: the prices of all its anchors and the times of the first `timeCount` of them. */
export function anchorLabels(anchors: readonly { time: number; price: number }[], selected: boolean, timeCount = anchors.length): AxisLabels {
  return selected ? { price: anchors.map((a) => a.price), time: anchors.slice(0, timeCount).map((a) => a.time) } : {};
}

/** Fills the polygon with the style's fill colour. */
export function fillPolygon(ctx: CanvasRenderingContext2D, poly: readonly Pt[], style: Readonly<Record<string, unknown>>): void {
  if (poly.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (const p of poly.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fillStyle = cssColor(style.fillColor, style.fillOpacity as number);
  ctx.fill();
}

/** Strokes one segment with the current stroke style. */
export function strokeSegment(ctx: CanvasRenderingContext2D, a: Pt, b: Pt): void {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

/** Whether p is in the filled polygon or within the tolerance of one of the given segments. */
export function hitsShape(p: Pt, poly: readonly Pt[], segments: readonly (readonly [Pt, Pt])[], tolerance = HIT_TOLERANCE): boolean {
  return segments.some(([a, b]) => distToSegment(p, a, b) <= tolerance) || (poly.length >= 3 && pointInPolygon(p, poly));
}

export const midpoint = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
