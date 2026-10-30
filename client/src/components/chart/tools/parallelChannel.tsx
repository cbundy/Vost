import { HIT_TOLERANCE, type Pt } from '../../../lib/drawingGeometry';
import { extendAcross, lineYAt, parallelEdge, parallelOffset } from '../../../lib/geometry/channels';
import { Svg } from '../../DrawingIcons';
import { applyDash, boolField, strokeColor, strokeWidth } from './fields';
import { anchorLabels, channelSettings, fillPolygon, hitsShape, midpoint, strokeSegment } from './channelShared';
import type { DrawingTool, ToolView } from './types';

type Edges = { first: [Pt, Pt]; second: [Pt, Pt] | null };

/** The two edges as drawn: the first from the anchors a-b, the second parallel through c (absent while c is unplaced). */
function edges(pts: Pt[], view: ToolView): Edges {
  const [a, b, c] = pts;
  const left = view.style.extendLeft === true;
  const right = view.style.extendRight === true;
  const first = extendAcross(a, b, view.width, left, right);
  const second = c ? extendAcross(...parallelEdge(a, b, parallelOffset(a, b, c)), view.width, left, right) : null;
  return { first, second };
}

/** Two parallel lines: a-b and the line through the third anchor, with a fill and a dashed middle line. */
export const parallelChannel: DrawingTool = {
  id: 'parallelChannel',
  label: 'Parallel channel',
  group: 'lines',
  section: 'Channels',
  icon: (
    <Svg>
      <line x1="4" y1="15" x2="18" y2="5" />
      <line x1="6" y1="20" x2="20" y2="10" />
    </Svg>
  ),
  anchors: 3,
  settings: channelSettings(true, [boolField('showMiddle', 'Middle line', true)]),
  axisLabels: (anchors, _style, selected) => anchorLabels(anchors, selected),
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const { first, second } = edges(pts, view);
    if (second) fillPolygon(ctx, [first[0], first[1], second[1], second[0]], view.style);
    ctx.strokeStyle = strokeColor(view, selected, undefined, 'color', null);
    ctx.lineWidth = strokeWidth(view, selected);
    applyDash(ctx, view.style.lineStyle);
    strokeSegment(ctx, first[0], first[1]);
    if (!second) return;
    strokeSegment(ctx, second[0], second[1]);
    if (view.style.showMiddle !== false) {
      ctx.lineWidth = Math.min(1, strokeWidth(view, selected));
      ctx.setLineDash([4, 4]);
      strokeSegment(ctx, midpoint(first[0], second[0]), midpoint(first[1], second[1]));
    }
    ctx.setLineDash([]);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 2) return false;
    const { first, second } = edges(pts, view);
    if (!second) return hitsShape(p, [], [first], tolerance);
    return hitsShape(p, [first[0], first[1], second[1], second[0]], [first, second], tolerance);
  },
  handles(pts) {
    const [a, b, c] = pts;
    if (!c) return pts;
    const edge = parallelEdge(a, b, parallelOffset(a, b, c));
    return [a, b, midpoint(edge[0], edge[1])];
  },
  /** Moving an end keeps the offset, so the channel stays parallel; the third handle sets the offset. */
  dragHandle([a, b, c], handle, p) {
    if (handle === 2) {
      const x = (a.x + b.x) / 2;
      const offset = p.y - lineYAt(a, b, x);
      return [a, b, { x: c.x, y: lineYAt(a, b, c.x) + offset }];
    }
    const offset = parallelOffset(a, b, c);
    const na = handle === 0 ? { x: p.x, y: p.y } : a;
    const nb = handle === 1 ? { x: p.x, y: p.y } : b;
    return [na, nb, { x: c.x, y: lineYAt(na, nb, c.x) + offset }];
  },
};
