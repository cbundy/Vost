import { HIT_TOLERANCE, distToSegment, type Pt } from '../../../lib/drawingGeometry';
import { FIB_WEDGE_TABLE, cssColor } from '../../../lib/drawingStyle';
import { distToWedgeArc, inWedgeSweep, wedgeGeometry } from '../../../lib/geometry/fib';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { anchorLabels, strokeSegment } from './channelShared';
import { boolField, opacityField, widthField } from './fields';
import { drawLevelLabel, enabledLevels } from './fibLevels';
import type { DrawingTool, ToolView } from './types';

type Arc = { ratio: number; r: number; color: string };

function arcs(pts: Pt[], view: ToolView): { arcs: Arc[]; g: NonNullable<ReturnType<typeof wedgeGeometry>> } | null {
  if (pts.length < 3) return null;
  const g = wedgeGeometry(pts[0], pts[1], pts[2]);
  if (!g) return null;
  const list = enabledLevels(view.style)
    .map((l) => ({ ratio: l.value, r: g.radius * Math.abs(l.value), color: l.color }))
    .filter((l) => l.r > 0 && Number.isFinite(l.r))
    .sort((a, b) => a.r - b.r);
  return { arcs: list, g };
}

/** The two edges: A-B and A towards C cut to the length of A-B. */
function edgeEnds(pts: Pt[], g: { radius: number; end: number }): [Pt, Pt] {
  return [pts[1], { x: pts[0].x + g.radius * Math.cos(g.end), y: pts[0].y + g.radius * Math.sin(g.end) }];
}

/** Arcs around A between the edge A-B and the edge towards C, at multiples of the length of A-B. */
export const fibWedge: DrawingTool = {
  id: 'fibWedge',
  label: 'Fib wedge',
  group: 'fib-gann',
  section: 'Fibonacci',
  icon: (
    <Svg>
      <path d="M4 20L20 20" />
      <path d="M4 20L18 8" />
      <path d="M10 20a6 6 0 0 1 2-4.5" />
      <path d="M15 20a11 11 0 0 1 3-8" />
    </Svg>
  ),
  anchors: 3,
  settings: [
    { key: 'levels', label: 'Levels', kind: 'levels', tab: 'style', default: FIB_WEDGE_TABLE },
    widthField('width', 'Width', 1),
    boolField('background', 'Background', true),
    opacityField('backgroundOpacity', 'Background opacity', 0.08),
    boolField('showLabels', 'Show labels', true, 'text'),
  ],
  axisLabels: (anchors, _style, selected) => anchorLabels(anchors, selected),
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const w = arcs(pts, view);
    if (!w) {
      ctx.strokeStyle = theme.muted2;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      strokeSegment(ctx, pts[0], pts[1]);
      ctx.setLineDash([]);
      return;
    }
    const [a] = pts;
    const { g } = w;
    const ccw = g.sweep < 0;
    if (view.style.background === true) {
      w.arcs.forEach((arc, i) => {
        if (i === 0) return;
        const inner = w.arcs[i - 1].r;
        ctx.beginPath();
        ctx.arc(a.x, a.y, arc.r, g.start, g.end, ccw);
        ctx.arc(a.x, a.y, inner, g.end, g.start, !ccw);
        ctx.closePath();
        ctx.fillStyle = cssColor(arc.color, view.style.backgroundOpacity as number);
        ctx.fill();
      });
    }
    ctx.lineWidth = (view.style.width as number) + (selected ? 0.5 : 0);
    for (const arc of w.arcs) {
      ctx.beginPath();
      ctx.arc(a.x, a.y, arc.r, g.start, g.end, ccw);
      ctx.strokeStyle = selected && !view.styled ? theme.accent2 : cssColor(arc.color);
      ctx.stroke();
      if (view.style.showLabels === true) {
        const x = a.x + Math.cos(g.start) * arc.r;
        const y = a.y + Math.sin(g.start) * arc.r;
        if (x >= 0 && x <= view.width && y >= 12 && y <= view.height) drawLevelLabel(ctx, `${arc.ratio}`, x + 3, y - 2);
      }
    }
    const [e1, e2] = edgeEnds(pts, g);
    ctx.strokeStyle = selected && !view.styled ? theme.accent2 : cssColor(w.arcs[w.arcs.length - 1]?.color);
    strokeSegment(ctx, a, e1);
    strokeSegment(ctx, a, e2);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 2) return false;
    const w = arcs(pts, view);
    if (!w) return pts.length === 2 && distToSegment(p, pts[0], pts[1]) <= tolerance;
    const [e1, e2] = edgeEnds(pts, w.g);
    if (distToSegment(p, pts[0], e1) <= tolerance || distToSegment(p, pts[0], e2) <= tolerance) return true;
    if (w.arcs.some((arc) => distToWedgeArc(p, pts[0], w.g, arc.r) <= tolerance)) return true;
    if (view.style.background !== true || w.arcs.length < 2) return false;
    const d = Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
    return d >= w.arcs[0].r && d <= w.arcs[w.arcs.length - 1].r && inWedgeSweep(p, pts[0], w.g);
  },
  handles: (pts) => pts,
};
