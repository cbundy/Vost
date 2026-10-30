import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { FIB_ARC_TABLE, cssColor } from '../../../lib/drawingStyle';
import { arcRadius, distToArc, onArcSide } from '../../../lib/geometry/fib';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { boolField, opacityField, widthField } from './fields';
import { drawLevelLabel, enabledLevels } from './fibLevels';
import type { DrawingTool, ToolView } from './types';

type Arc = { ratio: number; r: number; color: string };

function arcs(pts: { x: number; y: number }[], view: ToolView): Arc[] {
  if (pts.length < 2) return [];
  return enabledLevels(view.style)
    .map((l) => ({ ratio: l.value, r: arcRadius(pts[0], pts[1], l.value), color: l.color }))
    .filter((l) => l.r > 0 && Number.isFinite(l.r))
    .sort((a, b) => a.r - b.r);
}

/** Half circles around point 1, on the side of point 2, through the levels of the distance from point 1 to point 2. */
export const fibSpeedArcs: DrawingTool = {
  id: 'fibSpeedArcs',
  label: 'Fib speed resistance arcs',
  group: 'fib-gann',
  section: 'Fibonacci',
  icon: (
    <Svg>
      <path d="M4 20a8 8 0 0 1 16 0" />
      <path d="M8 20a4 4 0 0 1 8 0" />
    </Svg>
  ),
  anchors: 2,
  settings: [
    { key: 'levels', label: 'Levels', kind: 'levels', tab: 'style', default: FIB_ARC_TABLE },
    widthField('width', 'Width', 1),
    boolField('fullCircles', 'Full circles', false),
    boolField('background', 'Background', true),
    opacityField('backgroundOpacity', 'Background opacity', 0.08),
    boolField('showLabels', 'Show labels', true, 'text'),
  ],
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const [a, b] = pts;
    const full = view.style.fullCircles === true;
    const theta = Math.atan2(b.y - a.y, b.x - a.x);
    const start = full ? 0 : theta - Math.PI / 2;
    const end = full ? Math.PI * 2 : theta + Math.PI / 2;
    const as = arcs(pts, view);
    if (view.style.background === true) {
      as.forEach((arc, i) => {
        const inner = i > 0 ? as[i - 1].r : 0;
        ctx.beginPath();
        if (full) {
          ctx.moveTo(a.x + arc.r, a.y);
          ctx.arc(a.x, a.y, arc.r, 0, Math.PI * 2);
          if (inner > 0) {
            ctx.moveTo(a.x + inner, a.y);
            ctx.arc(a.x, a.y, inner, 0, Math.PI * 2);
          }
          ctx.fillStyle = cssColor(arc.color, view.style.backgroundOpacity as number);
          ctx.fill('evenodd');
          return;
        }
        ctx.arc(a.x, a.y, arc.r, start, end);
        if (inner > 0) ctx.arc(a.x, a.y, inner, end, start, true);
        else ctx.lineTo(a.x, a.y);
        ctx.closePath();
        ctx.fillStyle = cssColor(arc.color, view.style.backgroundOpacity as number);
        ctx.fill();
      });
    }
    ctx.lineWidth = (view.style.width as number) + (selected ? 0.5 : 0);
    for (const arc of as) {
      ctx.beginPath();
      ctx.arc(a.x, a.y, arc.r, start, end);
      ctx.strokeStyle = selected && !view.styled ? theme.accent2 : cssColor(arc.color);
      ctx.stroke();
      if (view.style.showLabels === true) {
        const x = a.x + Math.cos(theta) * arc.r;
        const y = a.y + Math.sin(theta) * arc.r;
        if (x >= 0 && x <= view.width && y >= 12 && y <= view.height) drawLevelLabel(ctx, `${arc.ratio}`, x + 3, y - 2);
      }
    }
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.muted2;
    ctx.stroke();
    ctx.restore();
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    const as = arcs(pts, view);
    if (as.length === 0) return false;
    const [a, b] = pts;
    const dir = { x: b.x - a.x, y: b.y - a.y };
    const full = view.style.fullCircles === true;
    if (view.style.background === true && onArcSide(p, a, dir, full) && Math.hypot(p.x - a.x, p.y - a.y) <= as[as.length - 1].r) return true;
    return as.some((arc) => distToArc(p, a, arc.r, dir, full) <= tolerance);
  },
  handles: (pts) => pts,
};
