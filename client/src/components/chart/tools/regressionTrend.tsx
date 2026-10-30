import { HIT_TOLERANCE, timeToLogical, type Pt } from '../../../lib/drawingGeometry';
import { extendAcross, regression, regressionAt, SOURCES } from '../../../lib/geometry/channels';
import { Svg } from '../../DrawingIcons';
import { applyDash, choiceField, colorField, numberField, strokeColor, strokeWidth } from './fields';
import { anchorLabels, channelSettings, fillPolygon, hitsShape, strokeSegment } from './channelShared';
import type { DrawingTool, ToolView } from './types';

type Lines = { base: [Pt, Pt]; upper: [Pt, Pt]; lower: [Pt, Pt]; /** The base line between the anchors, not extended. */ ends: [Pt, Pt] };

/**
 * The regression of the chosen source over the loaded bars between the anchors, as pixel lines; null when fewer than
 * two bars lie between them (or the price scale is not there).
 */
function lines(pts: Pt[], view: ToolView): Lines | null {
  if (pts.length < 2 || view.anchors.length < 2) return null;
  const [t0, t1] = [view.anchors[0].time, view.anchors[1].time];
  const r = regression(view.candles, t0, t1, view.style.source as string);
  if (!r) return null;
  const times = view.times.length > 0 ? view.times : view.candles.map((c) => c.time);
  const l0 = timeToLogical(times, t0);
  const l1 = timeToLogical(times, t1);
  const dev = (view.style.deviation as number) * r.stdev;
  const y = (price: number) => view.priceToY(price);
  const at = (logical: number, offset: number) => y(regressionAt(r, logical) + offset);
  const ys = [at(l0, 0), at(l1, 0), at(l0, dev), at(l1, dev), at(l0, -dev), at(l1, -dev)];
  if (ys.some((v) => v === null)) return null;
  const [b0, b1, u0, u1, d0, d1] = ys as number[];
  const left = view.style.extendLeft === true;
  const right = view.style.extendRight === true;
  const seg = (ya: number, yb: number): [Pt, Pt] => extendAcross({ x: pts[0].x, y: ya }, { x: pts[1].x, y: yb }, view.width, left, right);
  return {
    base: seg(b0, b1),
    upper: seg(u0, u1),
    lower: seg(d0, d1),
    ends: [{ x: pts[0].x, y: b0 }, { x: pts[1].x, y: b1 }],
  };
}

/** The upper and lower deviation lines' polygon. */
const band = (l: Lines): Pt[] => [l.upper[0], l.upper[1], l.lower[1], l.lower[0]];

/** A linear regression of a price source over the bars between two anchors, with deviation lines above and below. */
export const regressionTrend: DrawingTool = {
  id: 'regressionTrend',
  label: 'Regression trend',
  group: 'lines',
  section: 'Channels',
  icon: (
    <Svg>
      <line x1="3" y1="17" x2="21" y2="7" />
      <line x1="3" y1="11" x2="21" y2="3" strokeDasharray="2 3" />
      <line x1="3" y1="21" x2="21" y2="13" strokeDasharray="2 3" />
    </Svg>
  ),
  anchors: 2,
  settings: channelSettings(true, [
    colorField('upperColor', 'Upper line colour', 'accent'),
    colorField('lowerColor', 'Lower line colour', 'accent'),
    choiceField('source', 'Source', 'close', SOURCES.map((s) => ({ value: s, label: s }))),
    numberField('deviation', 'Deviation', 2, 0, 10, 0.1),
  ]),
  axisLabels: (anchors, _style, selected) => (selected ? { time: anchors.map((a) => a.time) } : {}),
  draw(ctx, pts, view, { selected }) {
    const l = lines(pts, view);
    if (!l) return;
    fillPolygon(ctx, band(l), view.style);
    ctx.lineWidth = strokeWidth(view, selected);
    applyDash(ctx, view.style.lineStyle);
    for (const [seg, key] of [[l.upper, 'upperColor'], [l.lower, 'lowerColor'], [l.base, 'color']] as const) {
      ctx.strokeStyle = strokeColor(view, selected, undefined, key, null);
      strokeSegment(ctx, seg[0], seg[1]);
    }
    ctx.setLineDash([]);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    const l = lines(pts, view);
    return !!l && hitsShape(p, band(l), [l.upper, l.lower, l.base], tolerance);
  },
  /** The handles sit on the regression line at the two anchors' times. */
  handles: (pts, view) => lines(pts, view)?.ends ?? pts,
};
