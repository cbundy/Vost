import { HIT_TOLERANCE, distToSegment, type Pt } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { SOURCES } from '../../../lib/geometry/channels';
import { anchoredVwap as computeVwap, type VwapResult } from '../../../lib/geometry/volume';
import { Svg } from '../../DrawingIcons';
import { applyDash, boolField, choiceField, colorField, lineStyleField, numberField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool, ToolView } from './types';

/** Band defaults follow TradingView's Anchored VWAP: the first band on, the others off, at 1, 2 and 3 deviations. */
const BANDS = [
  { n: 1, on: true, mult: 1, color: '#4caf50' },
  { n: 2, on: false, mult: 2, color: '#808000' },
  { n: 3, on: false, mult: 3, color: '#00897b' },
] as const;

const multipliers = (style: Readonly<Record<string, unknown>>): number[] => BANDS.map((b) => style[`mult${b.n}`] as number);

type Level = { color: string; fill: boolean; upper: Pt[]; lower: Pt[] };
type Lines = { main: Pt[]; levels: Level[] };

/** The VWAP result for a view's anchor, or null when the anchor is outside the loaded bars. */
function result(view: ToolView): VwapResult | null {
  if (view.anchors.length < 1) return null;
  return computeVwap(view.candles, view.anchors[0].time, view.style.source as string, multipliers(view.style));
}

/** The VWAP and its enabled bands as pixel polylines, narrowest band first; null when there is nothing to draw. */
function lines(view: ToolView): Lines | null {
  const r = result(view);
  if (!r || !view.indexToX) return null;
  const main: Pt[] = [];
  const at = (series: readonly (number | null)[]): Pt[] => {
    const out: Pt[] = [];
    series.forEach((v, i) => {
      if (v === null) return;
      const x = view.indexToX?.(r.first + i);
      const y = view.priceToY(v);
      if (x != null && y !== null && Number.isFinite(x)) out.push({ x, y });
    });
    return out;
  };
  main.push(...at(r.vwap));
  if (main.length === 0) return null;
  const levels = BANDS.filter((b) => view.style[`showBand${b.n}`] === true)
    .map((b) => ({ b, band: r.bands[b.n - 1] }))
    .sort((a, c) => a.band.multiplier - c.band.multiplier)
    .map(({ b, band }) => ({
      color: cssColor(view.style[`band${b.n}Color`]),
      fill: view.style[`fillBand${b.n}`] === true,
      upper: at(band.upper),
      lower: at(band.lower),
    }));
  return { main, levels };
}

function path(ctx: CanvasRenderingContext2D, pts: readonly Pt[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
}

/** y of a polyline at x, or null outside it. */
function yAt(pts: readonly Pt[], x: number): number | null {
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (x >= a.x && x <= b.x) return b.x === a.x ? a.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }
  return pts.length === 1 && pts[0].x === x ? pts[0].y : null;
}

const near = (pts: readonly Pt[], p: Pt, tol: number) => pts.some((a, i) => (i + 1 < pts.length ? distToSegment(p, a, pts[i + 1]) <= tol : Math.hypot(p.x - a.x, p.y - a.y) <= tol));

/** The volume-weighted average price from the anchor bar to the last bar, with optional standard deviation bands. */
export const anchoredVwap: DrawingTool = {
  id: 'anchoredVwap',
  label: 'Anchored VWAP',
  group: 'forecast-measure',
  section: 'Volume-based',
  icon: (
    <Svg>
      <path d="M4 16c4 0 5-6 9-6s4 3 7 3" />
      <path d="M4 8c4 0 5-4 9-4s4 2 7 2" strokeDasharray="2 3" />
      <circle cx="4" cy="16" r="1.5" />
    </Svg>
  ),
  anchors: 1,
  barTime: true,
  timeOnly: true,
  // TradingView's defaults: hlc3 source, one band at one deviation (green) on, two more off.
  settings: [
    colorField('color', 'VWAP colour', '#2962ff'),
    opacityField('opacity', 'VWAP opacity', 1),
    widthField('width', 'VWAP width', 1.5),
    lineStyleField('lineStyle', 'VWAP line style'),
    choiceField('source', 'Source', 'hlc3', SOURCES.map((s) => ({ value: s, label: s }))),
    opacityField('fillOpacity', 'Band fill opacity', 0.1),
    ...BANDS.flatMap((b) => [
      boolField(`showBand${b.n}`, `Band ${b.n}`, b.on),
      numberField(`mult${b.n}`, `Band ${b.n} multiplier`, b.mult, 0.1, 10, 0.1),
      colorField(`band${b.n}Color`, `Band ${b.n} colour`, b.color),
      boolField(`fillBand${b.n}`, `Band ${b.n} fill`, true),
    ]),
  ],
  axisLabels(anchors, style, selected, _times, candles = []) {
    if (!selected || anchors.length < 1) return {};
    const r = computeVwap(candles, anchors[0].time, style.source as string, multipliers(style));
    const last = r?.vwap[r.vwap.length - 1];
    return { time: [anchors[0].time], ...(last != null ? { price: [last] } : {}) };
  },
  draw(ctx, _pts, view, { selected }) {
    const l = lines(view);
    if (!l) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, view.width, view.height);
    ctx.clip();
    // Fills first, between the previous level and each band, so lines stay on top.
    let prev = l.main;
    for (const lv of l.levels) {
      if (lv.fill) {
        for (const edge of [lv.upper, lv.lower]) {
          if (edge.length < 2 || prev.length < 2) continue;
          path(ctx, [...edge, ...prev.slice().reverse()]);
          ctx.closePath();
          ctx.fillStyle = cssColor(lv.color, view.style.fillOpacity as number);
          ctx.fill();
        }
      }
      prev = lv.upper;
    }
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    for (const lv of l.levels) {
      ctx.strokeStyle = lv.color;
      for (const edge of [lv.upper, lv.lower]) {
        path(ctx, edge);
        ctx.stroke();
      }
    }
    ctx.lineWidth = strokeWidth(view, selected);
    ctx.strokeStyle = strokeColor(view, selected);
    applyDash(ctx, view.style.lineStyle);
    path(ctx, l.main);
    ctx.stroke();
    ctx.restore();
  },
  hit(_pts, p, view, tolerance = HIT_TOLERANCE) {
    const l = lines(view);
    if (!l) return false;
    if (near(l.main, p, tolerance)) return true;
    let [innerUp, innerLow] = [l.main, l.main];
    for (const lv of l.levels) {
      if (near(lv.upper, p, tolerance) || near(lv.lower, p, tolerance)) return true;
      if (lv.fill) {
        // A filled band also holds the press between its edge and the level inside it, on either side.
        for (const [outer, inner] of [[lv.upper, innerUp], [lv.lower, innerLow]] as const) {
          const [yo, yi] = [yAt(outer, p.x), yAt(inner, p.x)];
          if (yo !== null && yi !== null && p.y >= Math.min(yo, yi) && p.y <= Math.max(yo, yi)) return true;
        }
      }
      [innerUp, innerLow] = [lv.upper, lv.lower];
    }
    return false;
  },
  /** The handle sits on the VWAP line where it begins, at the anchor bar. */
  handles(pts, view) {
    const l = lines(view);
    return l ? [l.main[0]] : pts;
  },
  dragHandle: (orig, handle, p) => orig.map((o, i) => (i === handle ? { x: p.x, y: o.y } : o)),
};
