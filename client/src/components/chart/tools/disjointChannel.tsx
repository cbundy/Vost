import { HIT_TOLERANCE, type Pt } from '../../../lib/drawingGeometry';
import { disjointEdge } from '../../../lib/geometry/channels';
import { Svg } from '../../DrawingIcons';
import { applyDash, strokeColor, strokeWidth } from './fields';
import { anchorLabels, channelSettings, fillPolygon, hitsShape, strokeSegment } from './channelShared';
import type { DrawingTool } from './types';

/** Both edges and the polygon between them; the second edge starts at the third anchor and mirrors the first. */
const shape = ([a, b, c]: Pt[]): { first: [Pt, Pt]; second: [Pt, Pt]; poly: Pt[] } => {
  const second = disjointEdge(a, b, c);
  return { first: [a, b], second, poly: [a, b, second[1], second[0]] };
};

/** Two edges that are not parallel: the first from two anchors, the second from the third anchor, mirrored; filled between. */
export const disjointChannel: DrawingTool = {
  id: 'disjointChannel',
  label: 'Disjoint channel',
  group: 'lines',
  section: 'Channels',
  icon: (
    <Svg>
      <line x1="3" y1="12" x2="12" y2="4" />
      <line x1="12" y1="20" x2="21" y2="14" />
      <path d="M12 4l9 10M3 12l9 8" strokeDasharray="2 3" />
    </Svg>
  ),
  anchors: 3,
  settings: channelSettings(false),
  axisLabels: (anchors, _style, selected) => anchorLabels(anchors, selected),
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    ctx.strokeStyle = strokeColor(view, selected, undefined, 'color', null);
    ctx.lineWidth = strokeWidth(view, selected);
    applyDash(ctx, view.style.lineStyle);
    if (pts.length < 3) {
      strokeSegment(ctx, pts[0], pts[1]);
      ctx.setLineDash([]);
      return;
    }
    const { first, second, poly } = shape(pts);
    fillPolygon(ctx, poly, view.style);
    strokeSegment(ctx, first[0], first[1]);
    strokeSegment(ctx, second[0], second[1]);
    ctx.setLineDash([]);
  },
  hit(pts, p, _view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 2) return false;
    if (pts.length < 3) return hitsShape(p, [], [[pts[0], pts[1]]], tolerance);
    const { first, second, poly } = shape(pts);
    return hitsShape(p, poly, [first, second], tolerance);
  },
  handles: (pts) => pts,
};
