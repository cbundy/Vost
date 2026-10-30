import { HIT_TOLERANCE, distToSegment, extendSegment, measureSummary, type Pt } from '../../../lib/drawingGeometry';
import { cssColor, type SettingField } from '../../../lib/drawingStyle';
import { lineDistance } from '../../../lib/geometry/lines';
import { fmtDurationBarCount, fmtElapsed, fmtPct } from '../../../lib/format';
import { applyDash, boolField, colorField, lineStyleField, numberField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool, ToolView } from './types';

/** What a line tool shows or extends before the user changes it; the trend line has none of it, the ray extends right. */
export type LineDefaults = Partial<Record<'extendLeft' | 'extendRight' | 'arrowStart' | 'arrowEnd' | 'showPriceChange' | 'showAngle' | 'showBars' | 'showDistance', boolean>>;

/** The settings of the line tools; `defaults` overrides what a tool turns on, `text` adds the Text tab for tools with a label. */
export function lineSettings(defaults: LineDefaults = {}, text = false): SettingField[] {
  const fields: SettingField[] = [
    colorField('color', 'Colour', 'accent'),
    opacityField('opacity', 'Opacity', 1),
    widthField('width', 'Width', 1.5),
    lineStyleField('lineStyle', 'Line style'),
    boolField('extendLeft', 'Extend left', defaults.extendLeft ?? false),
    boolField('extendRight', 'Extend right', defaults.extendRight ?? false),
    boolField('arrowStart', 'Arrow at start', defaults.arrowStart ?? false),
    boolField('arrowEnd', 'Arrow at end', defaults.arrowEnd ?? false),
    boolField('showPriceChange', 'Show price change', defaults.showPriceChange ?? false),
    boolField('showAngle', 'Show angle', defaults.showAngle ?? false),
    boolField('showBars', 'Show bars', defaults.showBars ?? false),
    boolField('showDistance', 'Show distance', defaults.showDistance ?? false),
  ];
  if (!text) return fields;
  return [...fields, colorField('textColor', 'Text colour', 'text', 'text'), numberField('textSize', 'Text size', STATS_SIZE, 8, 48, 1, 'text')];
}

/** The pixels the line is drawn between: its anchors, continued as the style says. */
export function span([a, b]: Pt[], view: ToolView): [Pt, Pt] {
  return extendSegment(a, b, view.width, view.height, view.style.extendLeft === true, view.style.extendRight === true);
}

/** Fills an arrow head with its tip at `tip`, pointing away from `from`. */
export function arrowHead(ctx: CanvasRenderingContext2D, tip: Pt, from: Pt, size: number): void {
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - size * Math.cos(ang - 0.4), tip.y - size * Math.sin(ang - 0.4));
  ctx.lineTo(tip.x - size * Math.cos(ang + 0.4), tip.y - size * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

/** The default size of a line's label text. */
export const STATS_SIZE = 12;
const PAD = 6;

/** The label's text colour and size from the drawing's Text settings. */
export function labelText(view: ToolView): { color: string; size: number; font: string } {
  const size = (view.style.textSize as number | undefined) ?? STATS_SIZE;
  return { color: cssColor(view.style.textColor ?? 'text'), size, font: `${size}px sans-serif` };
}

function statsLines(view: ToolView, a: Pt, b: Pt): string[] {
  const [start, end] = view.anchors;
  const s = measureSummary(start, end, view.times);
  const lines: string[] = [];
  if (view.style.showPriceChange === true) lines.push(`${s.change > 0 ? '+' : ''}${view.formatPrice(s.change)} (${s.pct === null ? '—' : fmtPct(s.pct)})`);
  if (view.style.showBars === true) lines.push(`${fmtDurationBarCount(s.bars)}, ${fmtElapsed(s.seconds)}`);
  if (view.style.showAngle === true) lines.push(`${Math.round((Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI)}°`);
  if (view.style.showDistance === true) lines.push(`${Math.round(lineDistance(a, b))} px`);
  return lines;
}

function drawStats(ctx: CanvasRenderingContext2D, lines: string[], b: Pt, view: ToolView, color: string): void {
  const { color: textColor, size, font } = labelText(view);
  const LINE = size + 4;
  ctx.font = font;
  const lw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + PAD * 2;
  const lh = LINE * lines.length + PAD * 2;
  const lx = Math.max(2, Math.min(b.x + 8 + lw > view.width ? b.x - 8 - lw : b.x + 8, view.width - lw - 2));
  const ly = Math.max(2, Math.min(b.y - lh / 2, view.height - lh - 2));
  ctx.beginPath();
  ctx.roundRect(lx, ly, lw, lh, 4);
  ctx.fillStyle = 'rgba(23,23,27,0.92)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = textColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, lx + PAD, ly + PAD + LINE * i + LINE / 2));
}

/** A two-anchor line tool: the line tools differ in their id, label, icon, what they extend and what they show. */
export function lineTool(base: Pick<DrawingTool, 'id' | 'label' | 'group' | 'section' | 'icon'>, defaults: LineDefaults = {}, text = false): DrawingTool {
  return {
    ...base,
    anchors: 2,
    settings: lineSettings(defaults, text),
    axisLabels: (anchors, _style, selected) => (selected ? { price: anchors.map((a) => a.price), time: anchors.map((a) => a.time) } : {}),
    draw(ctx, pts, view, { selected }) {
      const [a, b] = pts;
      const [from, to] = span(pts, view);
      const color = strokeColor(view, selected);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth(view, selected);
      applyDash(ctx, view.style.lineStyle);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      const head = 6 + (view.style.width as number) * 2;
      if (view.style.arrowEnd === true) arrowHead(ctx, b, a, head);
      if (view.style.arrowStart === true) arrowHead(ctx, a, b, head);
      const lines = statsLines(view, a, b);
      if (lines.length) drawStats(ctx, lines, b, view, color);
    },
    hit(pts, p, view, tolerance = HIT_TOLERANCE) {
      const [from, to] = span(pts, view);
      return distToSegment(p, from, to) <= tolerance;
    },
    handles: (pts) => pts,
  };
}
