import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { pointInPolygon, polylineHit } from '../../../lib/geometry/shapes';
import { Svg } from '../../DrawingIcons';
import { CLOSED_SETTINGS, anchorLabels, filled, paintShape } from './closedShape';
import type { DrawingTool } from './types';

/** A triangle from its three vertices; each handle moves only its vertex. */
export const triangle: DrawingTool = {
  id: 'triangle',
  label: 'Triangle',
  group: 'shapes',
  section: 'Shapes',
  icon: (
    <Svg>
      <polygon points="12,5 20,19 4,19" />
    </Svg>
  ),
  anchors: 3,
  settings: CLOSED_SETTINGS,
  axisLabels: anchorLabels,
  draw(ctx, pts, view, { selected }) {
    paintShape(ctx, pts, view, selected, true);
  },
  hit: (pts, p, view, tolerance = HIT_TOLERANCE) => polylineHit(pts, p, true, tolerance) || (filled(view) && pointInPolygon(p, pts)),
  handles: (pts) => pts,
};
