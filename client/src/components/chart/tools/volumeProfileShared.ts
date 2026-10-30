import { HIT_TOLERANCE, distToSegment, type Pt } from '../../../lib/drawingGeometry';
import { cssColor, type SettingField } from '../../../lib/drawingStyle';
import { volumeProfile, type VolumeProfile } from '../../../lib/geometry/volume';
import { applyDash, boolField, choiceField, colorField, numberField, opacityField, strokeColor, widthField } from './fields';
import type { AxisLabels, ToolView } from './types';

/**
 * The settings of both profile tools. Defaults follow TradingView's volume profile drawings: 24 rows, a 70 percent
 * value area, a histogram taking 30 percent of the range on its left, up volume in blue and down volume in yellow.
 */
export const profileSettings: readonly SettingField[] = [
  choiceField('rowsLayout', 'Rows layout', 'rows', [
    { value: 'rows', label: 'Number of rows' },
    { value: 'ticks', label: 'Ticks per row' },
  ]),
  numberField('rowSize', 'Row size', 24, 1, 1000, 1),
  choiceField('volumeMode', 'Volume', 'updown', [
    { value: 'updown', label: 'Up/Down' },
    { value: 'total', label: 'Total' },
  ]),
  numberField('valueAreaVolume', 'Value area volume (%)', 70, 1, 100, 1),
  numberField('histogramWidth', 'Histogram width (% of range)', 30, 5, 100, 5),
  choiceField('placement', 'Placement', 'left', [
    { value: 'left', label: 'Left' },
    { value: 'right', label: 'Right' },
  ]),
  colorField('upColor', 'Up volume', '#2962ff'),
  colorField('downColor', 'Down volume', '#fbc02d'),
  opacityField('opacity', 'Volume opacity', 0.35),
  colorField('vaUpColor', 'Value area up volume', '#2962ff'),
  colorField('vaDownColor', 'Value area down volume', '#fbc02d'),
  opacityField('vaOpacity', 'Value area opacity', 0.75),
  boolField('showPoc', 'Point of control', true),
  colorField('pocColor', 'Point of control colour', '#f23645'),
  widthField('pocWidth', 'Point of control width', 1),
  boolField('extendPoc', 'Extend point of control right', false),
  boolField('showVaLines', 'Value area high and low', true),
  colorField('vaLineColor', 'Value area line colour', '#2962ff'),
  colorField('color', 'Outline colour', '#787b86'),
];

type Row = { y0: number; y1: number; up: number; total: number; inVa: boolean };

/** The profile as pixels: the range box, the rows (top y, bottom y, bar lengths), and the lines. */
export type Layout = {
  profile: VolumeProfile;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** Where the bars start and the way they grow (+1 right, -1 left). */
  edge: number;
  dir: 1 | -1;
  rows: Row[];
  pocY: number | null;
  vaHighY: number | null;
  vaLowY: number | null;
};

/** The profile over [t0, t1] drawn between the pixel columns x0 and x1, or null with no bars or no price scale. */
export function layoutFor(view: ToolView, t0: number, t1: number, x0: number, x1: number): Layout | null {
  const s = view.style;
  const profile = volumeProfile(view.candles, t0, t1, profileOptsOf(s));
  if (!profile) return null;
  [x0, x1] = [Math.min(x0, x1), Math.max(x0, x1)];
  const top = view.priceToY(profile.high);
  const bottom = view.priceToY(profile.low);
  if (top === null || bottom === null || !Number.isFinite(x0) || !Number.isFinite(x1)) return null;
  const maxLen = (Math.max(0, x1 - x0) * (s.histogramWidth as number)) / 100;
  const scale = profile.maxTotal > 0 ? maxLen / profile.maxTotal : 0;
  const rows: Row[] = [];
  profile.rows.forEach((r, i) => {
    const y0 = view.priceToY(r.high);
    const y1 = view.priceToY(r.low);
    if (y0 === null || y1 === null) return;
    rows.push({ y0: Math.min(y0, y1), y1: Math.max(y0, y1), up: r.up * scale, total: r.total * scale, inVa: i >= profile.vaLowRow && i <= profile.vaHighRow && profile.poc >= 0 });
  });
  const mid = (i: number) => {
    if (i < 0) return null;
    const a = view.priceToY(profile.rows[i].low);
    const b = view.priceToY(profile.rows[i].high);
    return a === null || b === null ? null : (a + b) / 2;
  };
  const right = s.placement === 'right';
  return {
    profile,
    x0,
    x1,
    top: Math.min(top, bottom),
    bottom: Math.max(top, bottom),
    edge: right ? x1 : x0,
    dir: right ? -1 : 1,
    rows,
    pocY: mid(profile.poc),
    vaHighY: profile.vaHigh === null ? null : view.priceToY(profile.vaHigh),
    vaLowY: profile.vaLow === null ? null : view.priceToY(profile.vaLow),
  };
}

const hline = (ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number) => {
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
};

/** Paints the range outline, the histogram rows, the value area lines and the point of control, clipped to the pane. */
export function drawProfile(ctx: CanvasRenderingContext2D, l: Layout, view: ToolView, selected: boolean): void {
  const s = view.style;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, view.width, view.height);
  ctx.clip();
  ctx.lineWidth = selected ? 1.5 : 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = strokeColor(view, selected, undefined, 'color', null);
  ctx.strokeRect(l.x0, l.top, l.x1 - l.x0, l.bottom - l.top);
  ctx.setLineDash([]);
  const total = s.volumeMode === 'total';
  for (const r of l.rows) {
    const h = Math.max(1, r.y1 - r.y0 - 1);
    const alpha = (r.inVa ? s.vaOpacity : s.opacity) as number;
    const upColor = cssColor(r.inVa ? s.vaUpColor : s.upColor, alpha);
    const downColor = cssColor(r.inVa ? s.vaDownColor : s.downColor, alpha);
    const seg = (from: number, len: number) => l.dir === 1 ? [l.edge + from, len] : [l.edge - from - len, len];
    if (total) {
      ctx.fillStyle = upColor;
      const [x, w] = seg(0, r.total);
      ctx.fillRect(x, r.y0, w, h);
    } else {
      ctx.fillStyle = upColor;
      const [ux, uw] = seg(0, r.up);
      ctx.fillRect(ux, r.y0, uw, h);
      ctx.fillStyle = downColor;
      const [dx, dw] = seg(r.up, r.total - r.up);
      ctx.fillRect(dx, r.y0, dw, h);
    }
  }
  ctx.lineWidth = 1;
  if (s.showVaLines === true) {
    ctx.strokeStyle = cssColor(s.vaLineColor);
    for (const y of [l.vaHighY, l.vaLowY]) if (y !== null) hline(ctx, l.x0, l.x1, y);
  }
  if (s.showPoc === true && l.pocY !== null) {
    ctx.lineWidth = s.pocWidth as number;
    ctx.strokeStyle = cssColor(s.pocColor);
    applyDash(ctx, 'solid');
    hline(ctx, l.x0, s.extendPoc === true ? view.width : l.x1, l.pocY);
  }
  ctx.restore();
}

/** Whether p is on a histogram row, the point of control, a value area line or the range outline. */
export function hitProfile(l: Layout, p: Pt, view: ToolView, tolerance = HIT_TOLERANCE): boolean {
  const corners: Pt[] = [{ x: l.x0, y: l.top }, { x: l.x1, y: l.top }, { x: l.x1, y: l.bottom }, { x: l.x0, y: l.bottom }];
  if (corners.some((c, i) => distToSegment(p, c, corners[(i + 1) % 4]) <= tolerance)) return true;
  for (const r of l.rows) {
    const [a, b] = l.dir === 1 ? [l.edge, l.edge + r.total] : [l.edge - r.total, l.edge];
    if (p.x >= a && p.x <= b && p.y >= r.y0 && p.y <= r.y1) return true;
  }
  const lineYs = [...(view.style.showVaLines === true ? [l.vaHighY, l.vaLowY] : []), ...(view.style.showPoc === true ? [l.pocY] : [])];
  const xEnd = view.style.extendPoc === true ? view.width : l.x1;
  return lineYs.some((y) => y !== null && Math.abs(p.y - y) <= tolerance && p.x >= l.x0 - tolerance && p.x <= (y === l.pocY ? xEnd : l.x1) + tolerance);
}

/** The y a range handle sits at: the middle of the range box. */
export const handleY = (l: Layout | null, fallback: number) => (l ? (l.top + l.bottom) / 2 : fallback);

/** Price axis label: the point of control's price while selected. */
export function pocLabel(candlesProfile: VolumeProfile | null, selected: boolean): Pick<AxisLabels, 'price'> {
  if (!selected || !candlesProfile || candlesProfile.poc < 0) return {};
  const r = candlesProfile.rows[candlesProfile.poc];
  return { price: [(r.low + r.high) / 2] };
}

/** The profile options for a style, shared by the layout and the axis labels. */
export function profileOptsOf(style: Readonly<Record<string, unknown>>) {
  return style.rowsLayout === 'ticks'
    ? { ticksPerRow: style.rowSize as number, valueAreaPct: style.valueAreaVolume as number }
    : { rows: style.rowSize as number, valueAreaPct: style.valueAreaVolume as number };
}
