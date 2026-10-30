import { HIT_TOLERANCE, type Pt } from '../../../lib/drawingGeometry';
import { barIndexAt, volumeProfile } from '../../../lib/geometry/volume';
import { Svg } from '../../DrawingIcons';
import { drawProfile, handleY, hitProfile, layoutFor, pocLabel, profileOptsOf, profileSettings, type Layout } from './volumeProfileShared';
import type { AxisLabels, DrawingTool, ToolView } from './types';
import type { OhlcBar } from '../../../lib/drawingGeometry';

/** The anchor's bar and the last bar's time, or null when the anchor is outside the loaded bars. */
function span(candles: readonly OhlcBar[], time: number): [number, number] | null {
  const i = barIndexAt(candles, time);
  return i < 0 ? null : [candles[i].time, candles[candles.length - 1].time];
}

function layout(pts: Pt[], view: ToolView): Layout | null {
  if (pts.length < 1 || view.anchors.length < 1) return null;
  const s = span(view.candles, view.anchors[0].time);
  if (!s) return null;
  const end = view.indexToX?.(view.candles.length - 1) ?? view.width;
  return layoutFor(view, s[0], s[1], pts[0].x, Math.max(end, pts[0].x));
}

/** The volume profile from the anchor bar to the last loaded bar; its range grows as new bars arrive. */
export const anchoredVolumeProfile: DrawingTool = {
  id: 'anchoredVolumeProfile',
  label: 'Anchored volume profile',
  group: 'forecast-measure',
  section: 'Volume-based',
  icon: (
    <Svg>
      <path d="M4 5h6M4 9h10M4 13h13M4 17h8M4 21h4" />
      <circle cx="20" cy="12" r="1.5" />
    </Svg>
  ),
  anchors: 1,
  barTime: true,
  timeOnly: true,
  settings: profileSettings,
  axisLabels(anchors, style, selected, _times, candles = []): AxisLabels {
    if (!selected || anchors.length < 1) return {};
    const s = span(candles, anchors[0].time);
    return { time: [anchors[0].time], ...(s ? pocLabel(volumeProfile(candles, s[0], s[1], profileOptsOf(style)), true) : {}) };
  },
  draw(ctx, pts, view, { selected }) {
    const l = layout(pts, view);
    if (l) drawProfile(ctx, l, view, selected);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    const l = layout(pts, view);
    return !!l && hitProfile(l, p, view, tolerance);
  },
  handles(pts, view) {
    const l = layout(pts, view);
    return pts.map((p) => ({ x: p.x, y: handleY(l, p.y) }));
  },
  dragHandle: (orig, handle, p) => orig.map((o, i) => (i === handle ? { x: p.x, y: o.y } : o)),
};
