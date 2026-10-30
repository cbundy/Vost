import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { arcPoints, pointInPolygon, polylineHit, sideDistance, sideMidOffset } from '../../../lib/geometry/shapes';
import { Svg } from '../../DrawingIcons';
import { CLOSED_SETTINGS, anchorLabels, filled, paintShape } from './closedShape';
import type { DrawingTool } from './types';

/** An arc: points 1 and 2 are its ends, point 3 sets the bulge; half an ellipse on point 3's side. A fill closes it to its chord. */
export const arc: DrawingTool = {
  id: 'arc',
  label: 'Arc',
  group: 'shapes',
  section: 'Shapes',
  icon: (
    <Svg>
      <path d="M4 17a8 10 0 0 1 16 0" />
    </Svg>
  ),
  anchors: 3,
  settings: CLOSED_SETTINGS,
  axisLabels: anchorLabels,
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    // Two points (while placing): the chord.
    paintShape(ctx, pts.length < 3 ? pts : arcPoints(pts[0], pts[1], pts[2]), view, selected, false);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 3) return false;
    const arcPts = arcPoints(pts[0], pts[1], pts[2]);
    return polylineHit(arcPts, p, false, tolerance) || (filled(view) && pointInPolygon(p, arcPts));
  },
  /** The two ends and the top of the bulge. */
  handles: (pts) => (pts.length < 3 ? pts : [pts[0], pts[1], sideMidOffset(pts[0], pts[1], sideDistance(pts[0], pts[1], pts[2]))]),
  /** An end keeps the bulge. */
  dragHandle(orig, handle, p) {
    const [a, b, c] = orig;
    const d = sideDistance(a, b, c);
    if (handle === 0) return [p, b, sideMidOffset(p, b, d)];
    if (handle === 1) return [a, p, sideMidOffset(a, p, d)];
    return [a, b, p];
  },
};
