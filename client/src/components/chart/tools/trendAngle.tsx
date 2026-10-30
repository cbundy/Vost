import { HIT_TOLERANCE, distToSegment, type Pt } from '../../../lib/drawingGeometry';
import { angleArc, arcRadius, lineAngleDeg, referenceEnd } from '../../../lib/geometry/lines';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { applyDash, strokeColor, strokeWidth } from './fields';
import { lineTool, lineSettings, span } from './lineTool';
import type { DrawingTool } from './types';

const line = lineTool(
  {
    id: 'trendAngle',
    label: 'Trend angle',
    group: 'lines',
    section: 'Lines',
    icon: (
      <Svg>
        <line x1="4" y1="19" x2="20" y2="19" strokeDasharray="2 2" />
        <line x1="4" y1="19" x2="19" y2="6" />
        <path d="M12 19 A8 8 0 0 0 10.5 14" />
      </Svg>
    ),
  },
  {},
);

/** A trend line with an arc and its angle in degrees at the first anchor and a dotted horizontal from it. */
export const trendAngle: DrawingTool = {
  ...line,
  settings: lineSettings().filter((f) => f.key !== 'showAngle'),
  draw(ctx, pts, view, opts) {
    line.draw(ctx, pts, view, opts);
    const [a, b] = pts;
    const color = strokeColor(view, opts.selected);
    const ref = referenceEnd(a, b, view.width);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(ref.x, ref.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.min(1, strokeWidth(view, opts.selected));
    ctx.setLineDash([2, 3]);
    ctx.stroke();
    applyDash(ctx, 'solid');
    const r = arcRadius(a, b);
    const arc = angleArc(a, b);
    ctx.beginPath();
    ctx.arc(a.x, a.y, r, arc.start, arc.end, arc.anticlockwise);
    ctx.stroke();
    const mid = (arc.start + arc.end) / 2;
    ctx.font = '12px sans-serif';
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tx = Math.max(2, Math.min(a.x + (r + 6) * Math.cos(mid), view.width - 40));
    const ty = Math.max(8, Math.min(a.y + (r + 6) * Math.sin(mid), view.height - 8));
    ctx.fillText(`${Math.round(lineAngleDeg(a, b))}°`, tx, ty);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    const [from, to] = span(pts, view);
    const ref = referenceEnd(pts[0], pts[1], view.width);
    return distToSegment(p, from, to) <= tolerance || distToSegment(p, pts[0] as Pt, ref) <= tolerance;
  },
};
