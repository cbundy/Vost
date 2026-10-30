import { HIT_TOLERANCE, barSlotTime, distToSegment, timeToLogical, type Pt } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { barsPatternCopy, sourceBars } from '../../../lib/geometry/barsPattern';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { drawBars, onBar, xMapper, type PxBar } from './barsShared';
import { boolField, choiceField, colorField, opacityField } from './fields';
import type { DrawingTool, ToolView } from './types';

const finite = (anchors: readonly { time: number; price: number }[]) => anchors.every((a) => Number.isFinite(a.time) && Number.isFinite(a.price));

type Anchor = { time: number; price: number };

/** Where the copy starts when the user has placed only the source run: one slot after its later end, at the open of its first bar. */
function defaultStart(view: ToolView): Anchor | null {
  const [a, b] = view.anchors;
  if (!a || !b) return null;
  const later = Math.max(a.time, b.time);
  const src = sourceBars(view.candles, a.time, b.time);
  return { time: barSlotTime(view.times, timeToLogical(view.times, later) + 1), price: src[0]?.open ?? a.price };
}

type Layout = { frame: { x0: number; x1: number; y0: number; y1: number }; bars: PxBar[] };

function layout(pts: Pt[], view: ToolView): Layout | null {
  if (pts.length < 2 || view.anchors.length < 2 || !finite(view.anchors)) return null;
  const [a, b] = view.anchors;
  const src = sourceBars(view.candles, a.time, b.time);
  let y0 = Math.min(pts[0].y, pts[1].y);
  let y1 = Math.max(pts[0].y, pts[1].y);
  if (src.length > 0) {
    const top = view.priceToY(Math.max(...src.map((c) => c.high)));
    const bottom = view.priceToY(Math.min(...src.map((c) => c.low)));
    if (top !== null && bottom !== null) [y0, y1] = [Math.min(top, bottom), Math.max(top, bottom)];
  }
  const frame = { x0: Math.min(pts[0].x, pts[1].x), x1: Math.max(pts[0].x, pts[1].x), y0, y1 };
  const start = view.anchors[2] ?? defaultStart(view);
  if (!start) return { frame, bars: [] };
  const copy = barsPatternCopy(view.candles, a.time, b.time, start.price, { mirrored: view.style.mirrored === true, flipped: view.style.flipped === true });
  const l0 = Math.round(timeToLogical(view.times, start.time));
  const x = xMapper(view, [
    { logical: timeToLogical(view.times, a.time), x: pts[0].x },
    { logical: timeToLogical(view.times, b.time), x: pts[1].x },
  ]);
  const bars: PxBar[] = [];
  copy.forEach((c, k) => {
    const cx = x(l0 + k);
    const next = x(l0 + k + 1);
    const ys = [c.open, c.high, c.low, c.close].map((p) => view.priceToY(p));
    if (cx === null || next === null || ys.some((y) => y === null)) return;
    const [open, high, low, close] = ys as number[];
    bars.push({ x: cx, w: Math.max(1, Math.abs(next - cx) * 0.6), open, high, low, close });
  });
  return { frame, bars };
}

/**
 * A Bars pattern: two points mark a run of bars and a third where a copy of that run starts ahead. The copy is worked
 * out from the loaded bars each time it is drawn (never stored), normal, mirrored in time and/or flipped upside down.
 */
export const barsPattern: DrawingTool = {
  id: 'barsPattern',
  label: 'Bars pattern',
  group: 'forecast-measure',
  section: 'Forecasting',
  icon: (
    <Svg>
      <path d="M4 18v-6M4 14h0M8 18V8M12 18v-4" />
      <path d="M16 12v-4M20 14V6" strokeDasharray="2 2" />
    </Svg>
  ),
  anchors: 3,
  placed: 2,
  barTime: true,
  settings: [
    colorField('color', 'Colour', 'accent'),
    colorField('downColor', 'Down colour', 'red'),
    opacityField('opacity', 'Opacity', 1),
    choiceField('mode', 'Display mode', 'hl', [
      { value: 'hl', label: 'HL bars' },
      { value: 'oc', label: 'OC bars' },
      { value: 'open', label: 'Line - open' },
      { value: 'high', label: 'Line - high' },
      { value: 'low', label: 'Line - low' },
      { value: 'close', label: 'Line - close' },
    ]),
    boolField('mirrored', 'Mirrored', false),
    boolField('flipped', 'Flipped', false),
  ],
  validate: (d) => (d.anchors.length === 3 && finite(d.anchors) ? d : null),
  axisLabels: (anchors, _style, selected) => (selected && anchors.length >= 3 ? { price: [anchors[2].price], time: anchors.map((a) => a.time) } : {}),
  draw(ctx, pts, view, { selected }) {
    const l = layout(pts, view);
    if (!l) return;
    const { frame } = l;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, view.width, view.height);
    ctx.clip();
    ctx.beginPath();
    ctx.rect(frame.x0, frame.y0, frame.x1 - frame.x0, frame.y1 - frame.y0);
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = selected ? 1.5 : 1;
    ctx.strokeStyle = selected && !view.styled ? theme.accent2 : cssColor(view.style.color, 0.7);
    ctx.stroke();
    ctx.setLineDash([]);
    const opacity = view.style.opacity as number;
    drawBars(ctx, l.bars, view.style.mode as string, cssColor(view.style.color, opacity), cssColor(view.style.downColor, opacity));
    ctx.restore();
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    const l = layout(pts, view);
    if (!l) return false;
    const { x0, x1, y0, y1 } = l.frame;
    const edges: [Pt, Pt][] = [
      [{ x: x0, y: y0 }, { x: x1, y: y0 }],
      [{ x: x1, y: y0 }, { x: x1, y: y1 }],
      [{ x: x1, y: y1 }, { x: x0, y: y1 }],
      [{ x: x0, y: y1 }, { x: x0, y: y0 }],
    ];
    return edges.some(([a, b]) => distToSegment(p, a, b) <= tolerance) || l.bars.some((b) => onBar(b, p, tolerance));
  },
  handles: (pts) => pts,
  /** The copy starts one bar slot after the run, at the open of its first bar (at point 1's price with no loaded bar there). */
  settle(pts, view) {
    if (pts.length !== 2 || !view) return pts;
    const start = defaultStart(view);
    if (!start) return pts;
    const later = view.anchors[0].time >= view.anchors[1].time ? 0 : 1;
    const l = Math.round(timeToLogical(view.times, start.time));
    const x = xMapper(view, view.anchors.map((a, i) => ({ logical: timeToLogical(view.times, a.time), x: pts[i].x })))(l);
    return [...pts, { x: x ?? pts[later].x + 10, y: view.priceToY(start.price) ?? pts[0].y }];
  },
};

