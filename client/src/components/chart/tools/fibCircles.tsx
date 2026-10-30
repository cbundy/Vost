import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { FIB_CIRCLE_TABLE, cssColor } from '../../../lib/drawingStyle';
import { circleRadius, distToCircle } from '../../../lib/geometry/fib';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { boolField, opacityField, widthField } from './fields';
import { drawLevelLabel, enabledLevels } from './fibLevels';
import type { DrawingTool, ToolView } from './types';

type Ring = { ratio: number; r: number; color: string };

/** The circles that are on with a radius, smallest first. */
function rings(pts: { x: number; y: number }[], view: ToolView): Ring[] {
  if (pts.length < 2) return [];
  return enabledLevels(view.style)
    .map((l) => ({ ratio: l.value, r: circleRadius(pts[0], pts[1], l.value), color: l.color }))
    .filter((l) => l.r > 0 && Number.isFinite(l.r))
    .sort((a, b) => a.r - b.r);
}

const centre = (pts: { x: number; y: number }[]) => ({ x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 });

/** Concentric circles around the midpoint of the two points; level 1 passes through both. */
export const fibCircles: DrawingTool = {
  id: 'fibCircles',
  label: 'Fib circles',
  group: 'fib-gann',
  section: 'Fibonacci',
  icon: (
    <Svg>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="8" />
    </Svg>
  ),
  anchors: 2,
  settings: [
    { key: 'levels', label: 'Levels', kind: 'levels', tab: 'style', default: FIB_CIRCLE_TABLE },
    widthField('width', 'Width', 1),
    boolField('background', 'Background', true),
    opacityField('backgroundOpacity', 'Background opacity', 0.08),
    boolField('showLabels', 'Show labels', true, 'text'),
  ],
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const c = centre(pts);
    const rs = rings(pts, view);
    if (view.style.background === true) {
      rs.forEach((ring, i) => {
        ctx.beginPath();
        ctx.moveTo(c.x + ring.r, c.y);
        ctx.arc(c.x, c.y, ring.r, 0, Math.PI * 2);
        if (i > 0) {
          ctx.moveTo(c.x + rs[i - 1].r, c.y);
          ctx.arc(c.x, c.y, rs[i - 1].r, 0, Math.PI * 2);
        }
        ctx.fillStyle = cssColor(ring.color, view.style.backgroundOpacity as number);
        ctx.fill('evenodd');
      });
    }
    ctx.lineWidth = (view.style.width as number) + (selected ? 0.5 : 0);
    for (const ring of rs) {
      ctx.beginPath();
      ctx.arc(c.x, c.y, ring.r, 0, Math.PI * 2);
      ctx.strokeStyle = selected && !view.styled ? theme.accent2 : cssColor(ring.color);
      ctx.stroke();
      const y = c.y - ring.r;
      if (view.style.showLabels === true && y >= 12 && y <= view.height && c.x >= 0 && c.x <= view.width) {
        drawLevelLabel(ctx, `${ring.ratio}`, c.x, y - 2, 'center');
      }
    }
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.muted2;
    ctx.stroke();
    ctx.restore();
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    const rs = rings(pts, view);
    if (rs.length === 0) return false;
    const c = centre(pts);
    if (view.style.background === true && Math.hypot(p.x - c.x, p.y - c.y) <= rs[rs.length - 1].r) return true;
    return rs.some((ring) => distToCircle(p, c, ring.r) <= tolerance);
  },
  handles: (pts) => pts,
};
