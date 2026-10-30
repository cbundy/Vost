import { HIT_TOLERANCE, type Pt } from '../../../lib/drawingGeometry';
import { flatEdge } from '../../../lib/geometry/channels';
import { Svg } from '../../DrawingIcons';
import { applyDash, strokeColor, strokeWidth } from './fields';
import { anchorLabels, channelSettings, fillPolygon, hitsShape, midpoint, strokeSegment } from './channelShared';
import type { DrawingTool } from './types';

/** The polygon between the sloped edge a-b and the flat edge at c's price. */
const shape = ([a, b, c]: Pt[]): { sloped: [Pt, Pt]; flat: [Pt, Pt]; poly: Pt[] } => {
  const flat = flatEdge(a, b, c);
  return { sloped: [a, b], flat, poly: [a, b, flat[1], flat[0]] };
};

/** A sloped edge from two anchors and a flat edge at the third anchor's price, filled between. */
export const flatTopBottom: DrawingTool = {
  id: 'flatTopBottom',
  label: 'Flat top/bottom',
  group: 'lines',
  section: 'Channels',
  icon: (
    <Svg>
      <line x1="4" y1="19" x2="20" y2="9" />
      <line x1="4" y1="5" x2="20" y2="5" />
    </Svg>
  ),
  anchors: 3,
  settings: channelSettings(false),
  axisLabels: (anchors, _style, selected) => anchorLabels(anchors, selected, 2),
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
    const { sloped, flat, poly } = shape(pts);
    fillPolygon(ctx, poly, view.style);
    strokeSegment(ctx, sloped[0], sloped[1]);
    strokeSegment(ctx, flat[0], flat[1]);
    ctx.setLineDash([]);
  },
  hit(pts, p, _view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 2) return false;
    if (pts.length < 3) return hitsShape(p, [], [[pts[0], pts[1]]], tolerance);
    const { sloped, flat, poly } = shape(pts);
    return hitsShape(p, poly, [sloped, flat], tolerance);
  },
  /** The third handle sits on the flat edge, halfway along it. */
  handles(pts) {
    if (pts.length < 3) return pts;
    const { flat } = shape(pts);
    return [pts[0], pts[1], midpoint(flat[0], flat[1])];
  },
};
