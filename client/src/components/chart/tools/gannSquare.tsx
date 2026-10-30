import { HIT_TOLERANCE, distToSegment, inFanPolygon, type Pt } from '../../../lib/drawingGeometry';
import { GANN_BOX_TABLE, GANN_SQUARE_ARC_TABLE, GANN_SQUARE_FAN_TABLE, cssColor } from '../../../lib/drawingStyle';
import { boxCoord, fanBands, fanEnd, fixedSquareCorner, ratioLabel, squareArc } from '../../../lib/geometry/gann';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { boolField, opacityField, widthField } from './fields';
import { drawLevelLabel, enabledLevels } from './fibLevels';
import type { DrawingTool, ToolView } from './types';

type Square = {
  a: Pt;
  b: Pt;
  grid: { ratio: number; x: number; y: number; color: string }[];
  fans: { v: number; end: Pt; color: string }[];
  arcs: { ratio: number; pts: Pt[]; color: string }[];
};

/** The square as drawn: point 1 is the origin, the opposite corner is point 2 (held square when `fixed`). */
function layout(pts: Pt[], view: ToolView, fixed: boolean): Square | null {
  if (pts.length < 2) return null;
  const a = pts[0];
  const b = fixed ? fixedSquareCorner(a, pts[1]) : pts[1];
  const grid = enabledLevels(view.style, 'levels').map((l) => ({ ratio: l.value, color: l.color, x: boxCoord(a.x, b.x, l.value), y: boxCoord(a.y, b.y, l.value) }));
  const fans = enabledLevels(view.style, 'fans').flatMap((l) => {
    const end = fanEnd(a, b, l.value);
    return end ? [{ v: l.value, end, color: l.color }] : [];
  });
  const arcs = enabledLevels(view.style, 'arcs').map((l) => ({ ratio: l.value, color: l.color, pts: squareArc(a, b, l.value) }));
  return { a, b, grid, fans, arcs };
}

/**
 * The square tools: a grid of level lines, fan lines from point 1 and quarter arcs around it, each its own table.
 * The fixed one keeps the square 1:1 in pixels.
 */
export function squareTool(base: Pick<DrawingTool, 'id' | 'label' | 'icon'>, fixed: boolean): DrawingTool {
  return {
    ...base,
    group: 'fib-gann',
    section: 'Gann',
    anchors: 2,
    settings: [
      { key: 'levels', label: 'Levels', kind: 'levels', tab: 'style', default: GANN_BOX_TABLE },
      { key: 'fans', label: 'Fans', kind: 'levels', tab: 'style', default: GANN_SQUARE_FAN_TABLE },
      { key: 'arcs', label: 'Arcs', kind: 'levels', tab: 'style', default: GANN_SQUARE_ARC_TABLE },
      widthField('width', 'Width', 1),
      boolField('background', 'Background', true),
      opacityField('backgroundOpacity', 'Background opacity', 0.08),
      boolField('showLabels', 'Show labels', true, 'text'),
    ],
    axisLabels: (anchors, _style, selected) => (selected ? { price: anchors.map((a) => a.price), time: anchors.map((a) => a.time) } : {}),
    draw(ctx, pts, view, { selected }) {
      const sq = layout(pts, view, fixed);
      if (!sq) return;
      const { a, b } = sq;
      const style = view.style;
      const stroke = (color: string) => (selected && !view.styled ? theme.accent2 : cssColor(color));
      if (style.background === true) {
        fanBands(a, b, sq.fans).forEach((poly, i) => {
          ctx.beginPath();
          poly.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
          ctx.closePath();
          ctx.fillStyle = cssColor(sq.fans[i + 1].color, style.backgroundOpacity as number);
          ctx.fill();
        });
      }
      ctx.lineWidth = (style.width as number) + (selected ? 0.5 : 0);
      ctx.strokeStyle = stroke('accent');
      ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      for (const g of sq.grid) {
        ctx.beginPath();
        ctx.moveTo(g.x, a.y);
        ctx.lineTo(g.x, b.y);
        ctx.moveTo(a.x, g.y);
        ctx.lineTo(b.x, g.y);
        ctx.strokeStyle = stroke(g.color);
        ctx.stroke();
      }
      for (const f of sq.fans) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(f.end.x, f.end.y);
        ctx.strokeStyle = stroke(f.color);
        ctx.stroke();
        if (style.showLabels === true) drawLevelLabel(ctx, ratioLabel(f.v), f.end.x + (f.end.x >= a.x ? 3 : -3), f.end.y, f.end.x >= a.x ? 'left' : 'right', 'middle');
      }
      for (const arc of sq.arcs) {
        ctx.beginPath();
        arc.pts.forEach((p, k) => (k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
        ctx.strokeStyle = stroke(arc.color);
        ctx.stroke();
      }
      if (style.showLabels === true) {
        const inside = (x: number, y: number) => x >= 0 && x <= view.width && y >= 0 && y <= view.height;
        for (const g of sq.grid) {
          if (inside(g.x, Math.min(a.y, b.y))) drawLevelLabel(ctx, `${g.ratio}`, g.x, Math.min(a.y, b.y) - 3, 'center', 'bottom');
          if (inside(Math.min(a.x, b.x), g.y)) drawLevelLabel(ctx, `${g.ratio}`, Math.min(a.x, b.x) - 3, g.y, 'right', 'middle');
        }
      }
    },
    hit(pts, p, view, tolerance = HIT_TOLERANCE) {
      const sq = layout(pts, view, fixed);
      if (!sq) return false;
      const { a, b } = sq;
      const c = [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
      if (c.some((q, i) => distToSegment(p, q, c[(i + 1) % 4]) <= tolerance)) return true;
      if (sq.grid.some((g) => distToSegment(p, { x: g.x, y: a.y }, { x: g.x, y: b.y }) <= tolerance || distToSegment(p, { x: a.x, y: g.y }, { x: b.x, y: g.y }) <= tolerance)) return true;
      if (sq.fans.some((f) => distToSegment(p, a, f.end) <= tolerance)) return true;
      if (sq.arcs.some((arc) => arc.pts.some((q, i) => i > 0 && distToSegment(p, arc.pts[i - 1], q) <= tolerance))) return true;
      return view.style.background === true && fanBands(a, b, sq.fans).some((poly) => inFanPolygon(p, poly));
    },
    /** Point 1 and the opposite corner; the fixed square shows the corner it holds square. */
    handles: (pts) => (pts.length < 2 ? pts : fixed ? [pts[0], fixedSquareCorner(pts[0], pts[1])] : pts),
    dragHandle: fixed ? (orig, handle, p) => (handle === 0 ? [{ x: p.x, y: p.y }, orig[1]] : [orig[0], fixedSquareCorner(orig[0], p)]) : undefined,
  };
}

export const gannSquare: DrawingTool = squareTool(
  {
    id: 'gannSquare',
    label: 'Gann square',
    icon: (
      <Svg>
        <rect x="4" y="5" width="16" height="14" />
        <line x1="4" y1="19" x2="20" y2="5" />
        <path d="M4 12a8 7 0 0 1 8 7" />
      </Svg>
    ),
  },
  false,
);
