import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { ellipseFrom3, ellipseHit, ellipseOutline, pointAtWidth, sideDistance, sideMidOffset } from '../../../lib/geometry/shapes';
import { Svg } from '../../DrawingIcons';
import { CLOSED_SETTINGS, anchorLabels, filled, paintShape } from './closedShape';
import type { DrawingTool } from './types';

/** An ellipse: points 1 and 2 are the ends of one axis (it rotates with it), point 3 sets the other semi-axis by its perpendicular distance. */
export const ellipse: DrawingTool = {
  id: 'ellipse',
  label: 'Ellipse',
  group: 'shapes',
  section: 'Shapes',
  icon: (
    <Svg>
      <ellipse cx="12" cy="12" rx="9" ry="5.5" transform="rotate(-25 12 12)" />
    </Svg>
  ),
  anchors: 3,
  settings: CLOSED_SETTINGS,
  axisLabels: anchorLabels,
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    // Two points (while placing): the axis.
    paintShape(ctx, pts.length < 3 ? pts : ellipseOutline(ellipseFrom3(pts[0], pts[1], pts[2])), view, selected, pts.length >= 3);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 3) return false;
    return ellipseHit(ellipseFrom3(pts[0], pts[1], pts[2]), p, filled(view), tolerance);
  },
  /** The four axis ends: the two points, then both ends of the other axis. */
  handles(pts) {
    if (pts.length < 3) return pts;
    const d = sideDistance(pts[0], pts[1], pts[2]);
    return [pts[0], pts[1], sideMidOffset(pts[0], pts[1], d), sideMidOffset(pts[0], pts[1], -d)];
  },
  /** An axis end keeps the other semi-axis; an end of the other axis sets it. */
  dragHandle(orig, handle, p) {
    const [a, b, c] = orig;
    const d = sideDistance(a, b, c);
    if (handle === 0) return [p, b, sideMidOffset(p, b, d)];
    if (handle === 1) return [a, p, sideMidOffset(a, p, d)];
    return [a, b, pointAtWidth(a, b, sideDistance(a, b, p))];
  },
};
