import { HIT_TOLERANCE, distToSegment } from '../../../lib/drawingGeometry';
import { sinePoints } from '../../../lib/geometry/cycles';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { applyDash, colorField, lineStyleField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool, ToolView } from './types';

const samples = (pts: { x: number; y: number }[], view: ToolView) => (pts.length < 2 ? [] : sinePoints(pts[0], pts[1], view.width, 3));

/** A sine wave with an extreme at point 1 and the opposite extreme at point 2, across the pane. */
export const sineLine: DrawingTool = {
  id: 'sineLine',
  label: 'Sine line',
  group: 'patterns',
  section: 'Cycles',
  icon: (
    <Svg>
      <path d="M2 12c3-10 6-10 10 0s7 10 10 0" />
    </Svg>
  ),
  anchors: 2,
  settings: [colorField('color', 'Colour', 'accent'), widthField('width', 'Width', 1), lineStyleField('lineStyle', 'Line style')],
  axisLabels(anchors, _style, selected) {
    if (!selected || anchors.length < 2) return {};
    return { time: [anchors[0].time, anchors[1].time] };
  },
  draw(ctx, pts, view, { selected }) {
    const s = samples(pts, view);
    if (s.length === 0) return;
    ctx.save();
    ctx.beginPath();
    s.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    ctx.lineWidth = strokeWidth(view, selected);
    ctx.strokeStyle = strokeColor(view, selected, theme.accent2, 'color', null);
    ctx.setLineDash([]);
    applyDash(ctx, view.style.lineStyle);
    ctx.stroke();
    ctx.restore();
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    const s = samples(pts, view);
    for (let i = 1; i < s.length; i++) if (distToSegment(p, s[i - 1], s[i]) <= tolerance) return true;
    return false;
  },
  handles: (pts) => pts,
};
