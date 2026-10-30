import { HIT_TOLERANCE, distToSegment, extendSegment, measureSummary, type Pt } from '../../../lib/drawingGeometry';
import type { SettingField } from '../../../lib/drawingStyle';
import { fmtDurationBarCount, fmtElapsed, fmtPct } from '../../../lib/format';
import { theme } from '../../../lib/theme';
import { applyDash, boolField, colorField, lineStyleField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool, ToolView } from './types';

/** The settings of the trend line and the ray; the ray extends to the right by default. */
export function lineSettings(extendRight: boolean): SettingField[] {
  return [
    colorField('color', 'Colour', 'accent'),
    opacityField('opacity', 'Opacity', 1),
    widthField('width', 'Width', 1.5),
    lineStyleField('lineStyle', 'Line style'),
    boolField('extendLeft', 'Extend left', false),
    boolField('extendRight', 'Extend right', extendRight),
    boolField('arrowStart', 'Arrow at start', false),
    boolField('arrowEnd', 'Arrow at end', false),
    boolField('showPriceChange', 'Show price change', false),
    boolField('showAngle', 'Show angle', false),
    boolField('showBars', 'Show bars', false),
  ];
}

/** The pixels the line is drawn between: its anchors, continued as the style says. */
function span([a, b]: Pt[], view: ToolView): [Pt, Pt] {
  return extendSegment(a, b, view.width, view.height, view.style.extendLeft === true, view.style.extendRight === true);
}

function arrowHead(ctx: CanvasRenderingContext2D, tip: Pt, from: Pt, size: number): void {
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - size * Math.cos(ang - 0.4), tip.y - size * Math.sin(ang - 0.4));
  ctx.lineTo(tip.x - size * Math.cos(ang + 0.4), tip.y - size * Math.sin(ang + 0.4));
  ctx.closePath();
  ctx.fill();
}

const STATS_FONT = '12px sans-serif';
const PAD = 6;
const LINE = 16;

function statsLines(view: ToolView, a: Pt, b: Pt): string[] {
  const [start, end] = view.anchors;
  const s = measureSummary(start, end, view.times);
  const lines: string[] = [];
  if (view.style.showPriceChange === true) lines.push(`${s.change > 0 ? '+' : ''}${view.formatPrice(s.change)} (${s.pct === null ? '—' : fmtPct(s.pct)})`);
  if (view.style.showBars === true) lines.push(`${fmtDurationBarCount(s.bars)}, ${fmtElapsed(s.seconds)}`);
  if (view.style.showAngle === true) lines.push(`${Math.round((Math.atan2(a.y - b.y, b.x - a.x) * 180) / Math.PI)}°`);
  return lines;
}

function drawStats(ctx: CanvasRenderingContext2D, lines: string[], b: Pt, view: ToolView, color: string): void {
  ctx.font = STATS_FONT;
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
  ctx.fillStyle = theme.text;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, lx + PAD, ly + PAD + LINE * i + LINE / 2));
}

/** A two-anchor line tool: trend line and ray differ only in their id, label, icon and default extension. */
export function lineTool(base: Pick<DrawingTool, 'id' | 'label' | 'group' | 'section' | 'icon'>, extendRight: boolean): DrawingTool {
  return {
    ...base,
    anchors: 2,
    settings: lineSettings(extendRight),
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
