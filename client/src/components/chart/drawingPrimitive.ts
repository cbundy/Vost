import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import { MOUSE_HIT, HANDLE_RADIUS, type HitOpts, hitsHandle, logicalToTime, timeToLogical, type Pt } from '../../lib/drawingGeometry';
import type { Anchor, Drawing } from '../../lib/drawings';
import { theme } from '../../lib/theme';
import { getTool } from './tools';
import type { ToolView } from './tools/types';

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

export type DrawingHit = { id: string; /** Index of the grabbed handle, or null for the body. */ handle: number | null };

/** One series primitive that draws every drawing of the current source, the selection handles and the draft. */
export class DrawingPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private requestUpdate: (() => void) | null = null;
  private drawings: Drawing[] = [];
  private draft: Drawing | null = null;
  private selectedId: string | null = null;
  private axisViews: ISeriesPrimitiveAxisView[] = [];
  private readonly view: IPrimitivePaneView;

  constructor(private readonly getTimes: () => readonly number[]) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target: RenderTarget) => this.paint(target),
    };
    this.view = { zOrder: () => 'top', renderer: () => renderer };
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = p.requestUpdate;
    this.rebuildAxisViews();
  }

  detached(): void {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  set(drawings: Drawing[], selectedId: string | null, draft: Drawing | null): void {
    this.drawings = drawings;
    this.selectedId = selectedId;
    this.draft = draft;
    this.rebuildAxisViews();
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }

  updateAllViews(): void {
    this.rebuildAxisViews();
  }

  /** Chart pixels of an anchor, or null when it cannot be placed (no data, off the scales). */
  toPoint(a: Anchor, anyX = false): Pt | null {
    if (!this.chart || !this.series) return null;
    const x = this.chart.timeScale().logicalToCoordinate(timeToLogical(this.getTimes(), a.time) as never);
    const y = this.series.priceToCoordinate(a.price);
    // A price-only tool (horizontal line) spans the width, so a time far off the scale still places it.
    if (y === null || (x === null && !anyX)) return null;
    return { x: x ?? 0, y };
  }

  /** Anchor under a chart pixel, or null. */
  toAnchor(p: Pt): Anchor | null {
    if (!this.chart || !this.series) return null;
    const times = this.getTimes();
    if (times.length === 0) return null;
    const logical = this.chart.timeScale().coordinateToLogical(p.x);
    const price = this.series.coordinateToPrice(p.y);
    if (logical === null || price === null) return null;
    return { time: logicalToTime(times, logical), price };
  }

  private points(d: Drawing): Pt[] | null {
    const pts: Pt[] = [];
    const anyX = getTool(d.tool)?.priceOnly === true;
    for (const a of d.anchors) {
      const pt = this.toPoint(a, anyX);
      if (!pt) return null;
      pts.push(pt);
    }
    return pts;
  }

  /** The view context a tool sees for a drawing's anchors; the pane size comes from the chart unless given. */
  viewFor(anchors: readonly Anchor[], size?: { width: number; height: number }): ToolView {
    const series = this.series;
    const pane = size ?? (this.chart ? this.chart.paneSize(0) : { width: 0, height: 0 });
    return {
      width: pane.width,
      height: pane.height,
      anchors,
      priceToY: (price) => series?.priceToCoordinate(price) ?? null,
      formatPrice: (price) => series?.priceFormatter().format(price) ?? String(price),
    };
  }

  /** What a press at p would grab: the selected drawing's handles first, then drawings from the top. */
  hit(p: Pt, opts: HitOpts = MOUSE_HIT): DrawingHit | null {
    const sel = this.drawings.find((d) => d.id === this.selectedId);
    if (sel) {
      const tool = getTool(sel.tool);
      const pts = tool && this.points(sel);
      if (tool && pts) {
        const hs = tool.handles(pts, this.viewFor(sel.anchors));
        for (let i = 0; i < hs.length; i++) if (hitsHandle(p, hs[i], opts.handleRadius)) return { id: sel.id, handle: i };
      }
    }
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      const tool = getTool(d.tool);
      const pts = tool && this.points(d);
      if (tool && pts && tool.hit(pts, p, this.viewFor(d.anchors), opts.tolerance)) return { id: d.id, handle: null };
    }
    return null;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const h = this.hit({ x, y });
    return h ? { cursorStyle: 'pointer', externalId: h.id, zOrder: 'top' } : null;
  }

  private paint(target: RenderTarget): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const all = this.draft ? [...this.drawings, this.draft] : this.drawings;
      for (const d of all) {
        const tool = getTool(d.tool);
        const pts = tool && this.points(d);
        if (!tool || !pts) continue;
        const selected = d.id === this.selectedId;
        ctx.save();
        const view = this.viewFor(d.anchors, mediaSize);
        tool.draw(ctx, pts, view, { selected });
        if (selected) {
          for (const h of tool.handles(pts, view)) {
            ctx.beginPath();
            ctx.arc(h.x, h.y, HANDLE_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = theme.bg;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = theme.text;
            ctx.stroke();
          }
        }
        // A draft whose two anchors are still equal (first tap placed) shows that anchor as a handle.
        const [first, second] = d.anchors;
        if (d === this.draft && d.anchors.length === 2 && first.time === second.time && first.price === second.price) {
          const p0 = pts[0];
          ctx.beginPath();
          ctx.arc(p0.x, p0.y, HANDLE_RADIUS, 0, Math.PI * 2);
          ctx.fillStyle = theme.bg;
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = theme.text;
          ctx.stroke();
        }
        ctx.restore();
      }
    });
  }

  /** Horizontal lines label their price on the price axis. */
  private rebuildAxisViews(): void {
    const series = this.series;
    if (!series) {
      this.axisViews = [];
      return;
    }
    const lines = this.drawings.filter((d) => d.tool === 'horizontalLine');
    this.axisViews = lines.map((d) => ({
      coordinate: () => series.priceToCoordinate(d.anchors[0].price) ?? -1000,
      text: () => series.priceFormatter().format(d.anchors[0].price),
      textColor: () => '#09090b',
      backColor: () => theme.amber,
      visible: () => series.priceToCoordinate(d.anchors[0].price) !== null,
    }));
  }
}
