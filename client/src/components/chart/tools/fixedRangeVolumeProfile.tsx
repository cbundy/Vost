import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { volumeProfile } from '../../../lib/geometry/volume';
import { Svg } from '../../DrawingIcons';
import { drawProfile, handleY, hitProfile, layoutFor, pocLabel, profileOptsOf, profileSettings, type Layout } from './volumeProfileShared';
import type { DrawingTool, ToolView } from './types';
import type { Pt } from '../../../lib/drawingGeometry';

function layout(pts: Pt[], view: ToolView): Layout | null {
  if (pts.length < 2 || view.anchors.length < 2) return null;
  return layoutFor(view, view.anchors[0].time, view.anchors[1].time, pts[0].x, pts[1].x);
}

/** The volume traded at each price level over the bars between two times, as a histogram with its point of control and value area. */
export const fixedRangeVolumeProfile: DrawingTool = {
  id: 'fixedRangeVolumeProfile',
  label: 'Fixed range volume profile',
  group: 'forecast-measure',
  section: 'Volume-based',
  icon: (
    <Svg>
      <path d="M4 5h6M4 9h10M4 13h13M4 17h8M4 21h4" />
      <path d="M20 3v18" strokeDasharray="2 3" />
    </Svg>
  ),
  anchors: 2,
  barTime: true,
  timeOnly: true,
  settings: profileSettings,
  axisLabels(anchors, style, selected, _times, candles = []) {
    if (!selected || anchors.length < 2) return {};
    return { time: anchors.map((a) => a.time), ...pocLabel(volumeProfile(candles, anchors[0].time, anchors[1].time, profileOptsOf(style)), true) };
  },
  draw(ctx, pts, view, { selected }) {
    const l = layout(pts, view);
    if (l) drawProfile(ctx, l, view, selected);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    const l = layout(pts, view);
    return !!l && hitProfile(l, p, view, tolerance);
  },
  /** The handles sit at the two ends of the range, halfway up it. */
  handles(pts, view) {
    const l = layout(pts, view);
    return pts.map((p) => ({ x: p.x, y: handleY(l, p.y) }));
  },
  dragHandle: (orig, handle, p) => orig.map((o, i) => (i === handle ? { x: p.x, y: o.y } : o)),
};
