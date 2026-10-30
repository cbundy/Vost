import { HIT_TOLERANCE, type Pt } from '../../../lib/drawingGeometry';
import { pointAtWidth, pointInPolygon, polylineHit, rotatedRectCorners, sideDistance } from '../../../lib/geometry/shapes';
import { Svg } from '../../DrawingIcons';
import { CLOSED_SETTINGS, anchorLabels, filled, paintShape } from './closedShape';
import type { DrawingTool } from './types';

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** A rectangle that rotates: points 1 and 2 are one side, point 3 sets the width (its perpendicular distance to that side). */
export const rotatedRectangle: DrawingTool = {
  id: 'rotatedRectangle',
  label: 'Rotated rectangle',
  group: 'shapes',
  section: 'Shapes',
  icon: (
    <Svg>
      <polygon points="4,13 13,4 20,11 11,20" />
    </Svg>
  ),
  anchors: 3,
  settings: CLOSED_SETTINGS,
  axisLabels: anchorLabels,
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    // Two points (while placing): the first side.
    paintShape(ctx, pts.length < 3 ? pts : rotatedRectCorners(pts[0], pts[1], pts[2]), view, selected, true);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 3) return false;
    const corners = rotatedRectCorners(pts[0], pts[1], pts[2]);
    return polylineHit(corners, p, true, tolerance) || (filled(view) && pointInPolygon(p, corners));
  },
  /** The two ends of the side, then the middles of the other three sides. */
  handles(pts) {
    if (pts.length < 3) return pts;
    const [a, b, b2, a2] = rotatedRectCorners(pts[0], pts[1], pts[2]);
    return [a, b, mid(b, b2), mid(a2, b2), mid(a, a2)];
  },
  /** An end keeps the width; a middle handle changes only the width, so it stays a rectangle. */
  dragHandle(orig, handle, p) {
    const [a, b, c] = orig;
    const w = sideDistance(a, b, c);
    if (handle === 0) return [p, b, pointAtWidth(p, b, w)];
    if (handle === 1) return [a, p, pointAtWidth(a, p, w)];
    // The side middles (handles 2 and 4) sit at half the width, the far one (3) at the full width.
    const d = sideDistance(a, b, p);
    return [a, b, pointAtWidth(a, b, handle === 3 ? d : d * 2)];
  },
};
