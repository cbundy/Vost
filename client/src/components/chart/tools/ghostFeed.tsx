import { HIT_TOLERANCE, timeToLogical, type Pt } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { GHOST_FEED_MAX_POINTS, ghostFeedBars } from '../../../lib/geometry/ghostFeed';
import { polylineHit } from '../../../lib/geometry/shapes';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { onBar, xMapper, type PxBar } from './barsShared';
import { colorField, numberField, opacityField } from './fields';
import type { DrawingTool, ToolView } from './types';

export { GHOST_FEED_MAX_POINTS };

const finite = (anchors: readonly { time: number; price: number }[]) => anchors.every((a) => Number.isFinite(a.time) && Number.isFinite(a.price));

/** The bars of a ghost feed in pixels, in drawing order (empty while the view has no scale or the anchors do not fit it). */
function layout(pts: Pt[], view: ToolView): PxBar[] {
  const anchors = view.anchors;
  if (pts.length < 2 || anchors.length < 2 || !finite(anchors)) return [];
  const slotOf = (t: number) => timeToLogical(view.times, t);
  const tick = view.tickSize && view.tickSize > 0 ? view.tickSize : 1;
  const bars = ghostFeedBars(anchors, slotOf, { avgHeight: (view.style.avgHeight as number) * tick, variance: view.style.variance as number });
  const x = xMapper(view, anchors.map((a, i) => ({ logical: Math.round(slotOf(a.time)), x: pts[i]?.x ?? NaN })).filter((k) => Number.isFinite(k.x)));
  const out: PxBar[] = [];
  for (const b of bars) {
    const cx = x(b.slot);
    const next = x(b.slot + 1);
    const ys = [b.open, b.high, b.low, b.close].map((p) => view.priceToY(p));
    if (cx === null || next === null || ys.some((y) => y === null)) continue;
    const [open, high, low, close] = ys as number[];
    out.push({ x: cx, w: Math.max(1, Math.abs(next - cx) * 0.7), open, high, low, close });
  }
  return out;
}

/**
 * A Ghost feed: bars drawn by hand into the future. Points are placed one by one; between each pair one bar per bar
 * slot follows the straight line from the first price to the second, with a body and wicks that vary around the
 * average height. The bars come from a generator seeded by the points, so they look the same on every repaint.
 */
export const ghostFeed: DrawingTool = {
  id: 'ghostFeed',
  label: 'Ghost feed',
  group: 'forecast-measure',
  section: 'Forecasting',
  icon: (
    <Svg>
      <path d="M4 18v-4M8 15V9M12 12V6M16 9V4" />
      <path d="M3 20 17 4" strokeDasharray="2 2" />
    </Svg>
  ),
  anchors: { min: 2, max: GHOST_FEED_MAX_POINTS },
  barTime: true,
  settings: [
    colorField('upColor', 'Up colour', 'green'),
    colorField('downColor', 'Down colour', 'red'),
    colorField('color', 'Border colour', 'muted'),
    opacityField('opacity', 'Opacity', 0.6),
    numberField('avgHeight', 'Average height (ticks)', 300, 0, 100000, 1),
    numberField('variance', 'Variance (%)', 50, 0, 100, 1),
  ],
  validate: (d) => (d.anchors.length >= 2 && d.anchors.length <= GHOST_FEED_MAX_POINTS && finite(d.anchors) ? d : null),
  axisLabels: (anchors, _style, selected) => (selected && anchors.length >= 2 ? { price: anchors.map((a) => a.price), time: [anchors[0].time, anchors[anchors.length - 1].time] } : {}),
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const bars = layout(pts, view);
    const opacity = view.style.opacity as number;
    const up = cssColor(view.style.upColor, opacity);
    const down = cssColor(view.style.downColor, opacity);
    const border = selected && !view.styled ? theme.accent2 : cssColor(view.style.color);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, view.width, view.height);
    ctx.clip();
    ctx.lineWidth = 1;
    for (const b of bars) {
      ctx.beginPath();
      ctx.moveTo(b.x, b.high);
      ctx.lineTo(b.x, b.low);
      ctx.strokeStyle = border;
      ctx.stroke();
      // Canvas y grows downward, so a rising bar has its close above its open (a smaller y).
      ctx.fillStyle = b.close <= b.open ? up : down;
      const top = Math.min(b.open, b.close);
      const h = Math.max(1, Math.abs(b.close - b.open));
      ctx.fillRect(b.x - b.w / 2, top, b.w, h);
      ctx.strokeRect(b.x - b.w / 2, top, b.w, h);
    }
    if (selected) {
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.strokeStyle = border;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  },
  hit: (pts, p, view, tolerance = HIT_TOLERANCE) => polylineHit(pts, p, false, tolerance) || layout(pts, view).some((b) => onBar(b, p, tolerance)),
  handles: (pts) => pts,
};
