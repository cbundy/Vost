import type { Pt } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { theme } from '../../../lib/theme';
import { applyDash, colorField, lineStyleField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { AxisLabels, ToolView } from './types';

/** The settings of a bordered, filled shape: the circle's. */
export const CLOSED_SETTINGS = [
  colorField('color', 'Border colour', 'accent'),
  widthField('width', 'Border width', 1.5),
  lineStyleField('lineStyle', 'Border style'),
  colorField('fillColor', 'Fill colour', 'accent'),
  opacityField('fillOpacity', 'Fill opacity', 0.15),
] as const;

/** Selected-only axis labels at every anchor. */
export const anchorLabels = (anchors: readonly { time: number; price: number }[], _style: unknown, selected: boolean): AxisLabels =>
  selected ? { price: anchors.map((a) => a.price), time: anchors.map((a) => a.time) } : {};

/** Whether the shape's fill is on (its opacity is above 0). */
export const filled = (view: ToolView): boolean => (view.style.fillOpacity as number) > 0;

/** Traces the points as a path, closed when `closed`. */
export function tracePath(ctx: CanvasRenderingContext2D, pts: readonly Pt[], closed: boolean): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  if (closed && pts.length > 2) ctx.closePath();
}

/**
 * Paints a bordered shape whose outline is `outline`: the fill (when `closedFill`, else none) then the border,
 * `closeBorder` closing the border path.
 */
export function paintShape(ctx: CanvasRenderingContext2D, outline: readonly Pt[], view: ToolView, selected: boolean, closeBorder: boolean, withFill = true): void {
  if (outline.length < 2) return;
  if (withFill && outline.length > 2) {
    tracePath(ctx, outline, true);
    ctx.fillStyle = cssColor(view.style.fillColor, view.style.fillOpacity as number);
    ctx.fill();
  }
  tracePath(ctx, outline, closeBorder);
  ctx.strokeStyle = strokeColor(view, selected, theme.accent2, 'color', null);
  ctx.lineWidth = strokeWidth(view, selected);
  ctx.lineJoin = 'round';
  applyDash(ctx, view.style.lineStyle);
  ctx.stroke();
  ctx.setLineDash([]);
}
