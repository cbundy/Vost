import { HIT_TOLERANCE, distToSegment } from '../../../lib/drawingGeometry';
import type { Pt } from '../../../lib/drawingGeometry';
import { arcPoints, cycleArcs } from '../../../lib/geometry/cycles';
import { cssColor } from '../../../lib/drawingStyle';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { applyDash, boolField, colorField, lineStyleField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool, ToolView } from './types';

type Arc = { from: number; to: number; pts: Pt[] };

/** The half arcs on point 1's price line, one point-to-point distance wide, bulging toward point 2's side. */
function arcs(pts: Pt[], view: ToolView): Arc[] {
  if (pts.length < 2) return [];
  const height = pts[1].y - pts[0].y;
  if (!Number.isFinite(height)) return [];
  return cycleArcs(pts[0].x, pts[1].x - pts[0].x, view.width, HIT_TOLERANCE).map((a) => ({ ...a, pts: arcPoints(a.from, a.to, pts[0].y, height) }));
}

/** A row of half arcs, each as wide as the distance between the points, on point 1's price line. */
export const timeCycles: DrawingTool = {
  id: 'timeCycles',
  label: 'Time cycles',
  group: 'patterns',
  section: 'Cycles',
  icon: (
    <Svg>
      <path d="M2 17a5 7 0 0 1 10 0" />
      <path d="M12 17a5 7 0 0 1 10 0" />
    </Svg>
  ),
  anchors: 2,
  settings: [
    colorField('color', 'Colour', 'accent'),
    widthField('width', 'Width', 1),
    lineStyleField('lineStyle', 'Line style'),
    boolField('background', 'Background', true),
    colorField('fillColor', 'Fill colour', 'accent'),
    opacityField('fillOpacity', 'Fill opacity', 0.15),
  ],
  axisLabels(anchors, _style, selected) {
    if (!selected || anchors.length < 2) return {};
    return { time: [anchors[0].time, anchors[1].time] };
  },
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const list = arcs(pts, view);
    ctx.save();
    for (const a of list) {
      ctx.beginPath();
      a.pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
      if (view.style.background === true) {
        ctx.closePath();
        ctx.fillStyle = cssColor(view.style.fillColor, view.style.fillOpacity as number);
        ctx.fill();
      }
    }
    ctx.lineWidth = strokeWidth(view, selected);
    ctx.strokeStyle = strokeColor(view, selected, theme.accent2, 'color', null);
    ctx.setLineDash([]);
    applyDash(ctx, view.style.lineStyle);
    for (const a of list) {
      ctx.beginPath();
      a.pts.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
      ctx.stroke();
    }
    ctx.restore();
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    const fill = view.style.background === true;
    for (const a of arcs(pts, view)) {
      if (p.x < a.from - tolerance || p.x > a.to + tolerance) continue;
      for (let i = 1; i < a.pts.length; i++) if (distToSegment(p, a.pts[i - 1], a.pts[i]) <= tolerance) return true;
      if (fill && p.x >= a.from && p.x <= a.to) {
        // Inside: between the base line and the arc at this x.
        const base = pts[0].y;
        const top = pts[1].y - base;
        const t = (p.x - (a.from + a.to) / 2) / ((a.to - a.from) / 2);
        const h = Math.abs(t) <= 1 ? Math.abs(top) * Math.sqrt(1 - t * t) : 0;
        const dy = (p.y - base) * Math.sign(top || 1);
        if (dy >= 0 && dy <= h) return true;
      }
    }
    return false;
  },
  handles: (pts) => pts,
};
