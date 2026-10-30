import type { ReactNode } from 'react';
import { HIT_TOLERANCE, distToSegment, pointInRect, type Pt } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { fmtCompact, fmtDurationBarCount, fmtElapsed, fmtPct } from '../../../lib/format';
import { rangeSummary } from '../../../lib/geometry/ranges';
import { theme } from '../../../lib/theme';
import { applyDash, boolField, colorField, lineStyleField, numberField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool, ToolView } from './types';

export type RangeKind = 'price' | 'date' | 'both';

const PAD = 5;
const ARROW = 7;

/** The box as drawn: the pixel span of the two points, extended to the pane edge on an extended side. */
function bounds([a, b]: Pt[], kind: RangeKind, view: ToolView): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Math.min(a.x, b.x);
  let x1 = Math.max(a.x, b.x);
  let y0 = Math.min(a.y, b.y);
  let y1 = Math.max(a.y, b.y);
  if (kind === 'price') {
    if (view.style.extendLeft === true) x0 = 0;
    if (view.style.extendRight === true) x1 = view.width;
  } else if (kind === 'date') {
    if (view.style.extendTop === true) y0 = 0;
    if (view.style.extendBottom === true) y1 = view.height;
  }
  return { x0, y0, x1, y1 };
}

/** The arrows as segments: a vertical one at the horizontal centre and/or a horizontal one at the vertical centre. */
function arrows([a, b]: Pt[], kind: RangeKind): [Pt, Pt][] {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const out: [Pt, Pt][] = [];
  if (kind !== 'date') out.push([{ x: cx, y: a.y }, { x: cx, y: b.y }]);
  if (kind !== 'price') out.push([{ x: a.x, y: cy }, { x: b.x, y: cy }]);
  return out;
}

function arrow(ctx: CanvasRenderingContext2D, from: Pt, to: Pt): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  const len = Math.hypot(to.x - from.x, to.y - from.y);
  if (len > 0) {
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const head = Math.min(ARROW, len);
    for (const s of [-1, 1]) {
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - head * Math.cos(ang + s * 0.45), to.y - head * Math.sin(ang + s * 0.45));
    }
  }
  ctx.stroke();
}

function labelLines(kind: RangeKind, view: ToolView): string[] {
  const [s, e] = view.anchors;
  const sum = rangeSummary(s, e, view.times, view.candles, view.tickSize);
  const sign = sum.change > 0 ? '+' : '';
  const price = `${sign}${view.formatPrice(sum.change)} (${sum.pct === null ? '-' : fmtPct(sum.pct)})${sum.ticks === null ? '' : ` ${sum.ticks} ticks`}`;
  const bars = fmtDurationBarCount(sum.bars);
  const time = `${e.time < s.time && sum.bars > 0 ? '-' : ''}${bars}, ${fmtElapsed(sum.seconds)}`;
  const vol = `Vol ${fmtCompact(sum.volume)}`;
  return kind === 'price' ? [price] : kind === 'date' ? [time, vol] : [price, time, vol];
}

function drawBox(ctx: CanvasRenderingContext2D, lines: string[], cx: number, y: number, above: boolean, view: ToolView): void {
  const size = view.style.textSize as number;
  ctx.font = `${size}px sans-serif`;
  const lh = size + 4;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + PAD * 2;
  const h = lines.length * lh + PAD * 2 - 4;
  const x = Math.max(2, Math.min(cx - w / 2, view.width - w - 2));
  const top = Math.max(2, Math.min(above ? y - h - 6 : y + 6, view.height - h - 2));
  if (view.style.labelFill !== false) {
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, 4);
    ctx.fillStyle = cssColor(view.style.labelFillColor);
    ctx.fill();
  }
  ctx.fillStyle = cssColor(view.style.textColor);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, x + w / 2, top + PAD + lh * i + (lh - 4) / 2));
}

/**
 * A range tool: a box between two anchors with arrows along the measured axis (price, date, or both) and a label with
 * the figures of `rangeSummary`. Stored as two anchors.
 */
export function rangeTool(kind: RangeKind, id: string, label: string, icon: ReactNode): DrawingTool {
  return {
    id,
    label,
    group: 'forecast-measure',
    section: 'Measurers',
    icon,
    anchors: 2,
    settings: [
      colorField('color', 'Line colour', 'accent'),
      widthField('width', 'Line width', 1),
      lineStyleField('lineStyle', 'Line style'),
      boolField('fill', 'Background', true),
      colorField('fillColor', 'Background colour', 'accent'),
      opacityField('fillOpacity', 'Background opacity', 0.2),
      colorField('textColor', 'Text colour', 'text'),
      numberField('textSize', 'Font size', 12, 8, 48, 1),
      boolField('labelFill', 'Label background', true),
      colorField('labelFillColor', 'Label background colour', 'accent'),
      ...(kind === 'price' ? [boolField('extendLeft', 'Extend left', false), boolField('extendRight', 'Extend right', false)] : []),
      ...(kind === 'date' ? [boolField('extendTop', 'Extend top', false), boolField('extendBottom', 'Extend bottom', false)] : []),
    ],
    validate(d) {
      return d.anchors.length === 2 && d.anchors.every((a) => Number.isFinite(a.time) && Number.isFinite(a.price)) ? d : null;
    },
    axisLabels: (anchors, _style, selected) =>
      selected && anchors.length >= 2
        ? { ...(kind !== 'date' ? { price: anchors.map((a) => a.price) } : {}), ...(kind !== 'price' ? { time: anchors.map((a) => a.time) } : {}) }
        : {},
    draw(ctx, pts, view, { selected }) {
      if (pts.length < 2) return;
      const { x0, y0, x1, y1 } = bounds(pts, kind, view);
      const line = strokeColor(view, selected, theme.accent2, 'color', null);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, view.width, view.height);
      ctx.clip();
      if (view.style.fill !== false) {
        ctx.fillStyle = cssColor(view.style.fillColor, view.style.fillOpacity as number);
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      ctx.strokeStyle = line;
      ctx.lineWidth = strokeWidth(view, selected);
      applyDash(ctx, view.style.lineStyle);
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.setLineDash([]);
      for (const [from, to] of arrows(pts, kind)) arrow(ctx, from, to);
      if (view.anchors.length >= 2) {
        const up = pts[1].y <= pts[0].y;
        // The label hangs off the edge the move heads for: below the box on a fall, above it on a rise.
        const above = kind === 'date' ? true : up;
        drawBox(ctx, labelLines(kind, view), (pts[0].x + pts[1].x) / 2, above ? y0 : y1, above, view);
      }
      ctx.restore();
    },
    hit(pts, p, view, tolerance = HIT_TOLERANCE) {
      if (pts.length < 2) return false;
      const { x0, y0, x1, y1 } = bounds(pts, kind, view);
      if (arrows(pts, kind).some(([a, b]) => distToSegment(p, a, b) <= tolerance)) return true;
      if (view.style.fill !== false) return pointInRect(p, { x: x0, y: y0 }, { x: x1, y: y1 }, tolerance);
      const edges: [Pt, Pt][] = [
        [{ x: x0, y: y0 }, { x: x1, y: y0 }],
        [{ x: x1, y: y0 }, { x: x1, y: y1 }],
        [{ x: x1, y: y1 }, { x: x0, y: y1 }],
        [{ x: x0, y: y1 }, { x: x0, y: y0 }],
      ];
      return edges.some(([a, b]) => distToSegment(p, a, b) <= tolerance);
    },
    handles: (pts) => pts.slice(0, 2),
  };
}
