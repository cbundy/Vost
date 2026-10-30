import type {
  AutoscaleInfo,
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { timeToLogical, type Pt } from '../lib/drawingGeometry';
import { drawingPriceRange } from '../lib/pine/drawingObjects';
import { lineDash } from '../lib/drawingStyle';
import { boxRect, boxTextLines, linefillPolygon, lineSpan, polylinePoints } from '../lib/pine/drawingGeometry';
import type { PineBox, PineDrawings, PineLine, PinePolyline } from '../lib/pine/types';
import { arrowHead } from './chart/tools/lineTool';

type Ctx = CanvasRenderingContext2D;

/**
 * The line, box, polyline and linefill objects of a Pine script in one pane. Read-only: it never answers a hit
 * test, so a click or hover passes through to the chart. Times are placed on the chart's own bar times, so the
 * objects stay on their bars when older history loads.
 */
export class PineDrawingsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private data: PineDrawings | null = null;
  private readonly view: IPrimitivePaneView;

  /**
   * @param getTimes the chart's bar times, seconds
   * @param ownScale the primitive is what sets the pane's price range (a pane with nothing else in it)
   */
  constructor(
    private readonly getTimes: () => readonly number[],
    private readonly ownScale: boolean,
  ) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) =>
        target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paint(context, mediaSize.width, mediaSize.height)),
    };
    this.view = { zOrder: () => 'top', renderer: () => renderer };
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setData(data: PineDrawings | null): void {
    this.data = data;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  /** Pine objects are not interactive. */
  hitTest(): PrimitiveHoveredItem | null {
    return null;
  }

  autoscaleInfo(): AutoscaleInfo | null {
    if (!this.ownScale || !this.data) return null;
    const range = drawingPriceRange(this.data);
    return range && { priceRange: { minValue: range.min, maxValue: range.max } };
  }

  private paint(ctx: Ctx, width: number, height: number): void {
    const { chart, series, data } = this;
    if (!chart || !series || !data) return;
    const times = this.getTimes();
    if (times.length === 0) return;
    const scale = chart.timeScale();
    const pt = (time: number, price: number): Pt | null => {
      const x = scale.logicalToCoordinate(timeToLogical(times, time) as never);
      const y = series.priceToCoordinate(price);
      return x === null || y === null ? null : { x, y };
    };
    const span = (l: PineLine): [Pt, Pt] | null => {
      const a = pt(l.time1, l.price1);
      const b = pt(l.time2, l.price2);
      return a && b ? lineSpan(a, b, l.extend, width, height) : null;
    };

    for (const f of data.linefills) {
      const s1 = span(f.line1);
      const s2 = span(f.line2);
      if (f.color && s1 && s2) fillPoly(ctx, linefillPolygon(s1, s2), f.color);
    }
    for (const p of data.polylines) paintPolyline(ctx, p, pt);
    for (const b of data.boxes) paintBox(ctx, b, pt, width);
    for (const l of data.lines) {
      const a = pt(l.time1, l.price1);
      const b = pt(l.time2, l.price2);
      const s = span(l);
      if (l.color && a && b && s) paintLine(ctx, l, s, a, b);
    }
  }
}

function fillPoly(ctx: Ctx, pts: readonly Pt[], color: string): void {
  if (pts.length < 3) return;
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function stroke(ctx: Ctx, color: string, width: number, style: PineLine['style']): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.setLineDash(lineDash(style));
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintLine(ctx: Ctx, l: PineLine, [from, to]: [Pt, Pt], a: Pt, b: Pt): void {
  const arrowAtA = l.arrows === 'left' || l.arrows === 'both';
  const arrowAtB = l.arrows === 'right' || l.arrows === 'both';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  // An arrow line is always solid.
  stroke(ctx, l.color!, l.width, l.arrows === 'none' ? l.style : 'solid');
  ctx.fillStyle = l.color!;
  const size = Math.max(8, l.width * 4);
  if (arrowAtA) arrowHead(ctx, a, b, size);
  if (arrowAtB) arrowHead(ctx, b, a, size);
}

function paintBox(ctx: Ctx, b: PineBox, pt: (t: number, p: number) => Pt | null, width: number): void {
  const a = pt(b.time1, b.top);
  const c = pt(b.time2, b.bottom);
  if (!a || !c) return;
  const r = boxRect(a, c, b.extend, width);
  if (b.bgColor) {
    ctx.fillStyle = b.bgColor;
    ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  }
  if (b.borderColor && b.borderWidth > 0) {
    ctx.beginPath();
    ctx.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
    stroke(ctx, b.borderColor, b.borderWidth, b.borderStyle);
  }
  if (!b.text || !b.textColor) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
  ctx.clip();
  ctx.font = `${b.textSize}px sans-serif`;
  ctx.fillStyle = b.textColor;
  ctx.textAlign = b.halign;
  ctx.textBaseline = 'middle';
  for (const line of boxTextLines(r, b.text, b.textSize, b.halign, b.valign, b.wrap, (s) => ctx.measureText(s).width)) {
    ctx.fillText(line.text, line.x, line.y);
  }
  ctx.restore();
}

function paintPolyline(ctx: Ctx, p: PinePolyline, pt: (t: number, p: number) => Pt | null): void {
  const px = p.points.map((q) => pt(q.time, q.price));
  if (px.some((q) => q === null)) return;
  const path = polylinePoints(px as Pt[], p.curved, p.closed);
  if (path.length < 2) return;
  const trace = () => {
    ctx.beginPath();
    path.forEach((q, i) => (i === 0 ? ctx.moveTo(q.x, q.y) : ctx.lineTo(q.x, q.y)));
    if (p.closed) ctx.closePath();
  };
  if (p.fillColor && p.closed && path.length > 2) {
    trace();
    ctx.fillStyle = p.fillColor;
    ctx.fill();
  }
  if (p.lineColor) {
    trace();
    stroke(ctx, p.lineColor, p.width, p.style);
  }
}

/** Attaches a drawings primitive to `series`; the hook sets its data. */
export function attachPineDrawings(series: ISeriesApi<SeriesType>, getTimes: () => readonly number[], ownScale: boolean): PineDrawingsPrimitive {
  const prim = new PineDrawingsPrimitive(getTimes, ownScale);
  series.attachPrimitive(prim);
  return prim;
}
