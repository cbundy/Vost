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
import { MOUSE_HIT, HANDLE_RADIUS, type HitOpts, type OhlcBar, barSlotTime, hitsHandle, logicalToTime, timeToLogical, type Pt } from '../../lib/drawingGeometry';
import { cssColor, resolveStyle, timeframeKind, visibleOn } from '../../lib/drawingStyle';
import { anchorRange, type Anchor, type Drawing } from '../../lib/drawings';
import { inBox, type Rect } from '../../lib/drawingSelection';
import { onGlyphLoaded } from '../../lib/iconSets';
import { theme } from '../../lib/theme';
import { fractionToPoint, pointToFraction } from './paneAnchor';
import { getTool } from './tools';
import type { DrawingTool, ToolView } from './tools/types';

type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0];

export type DrawingHit = { id: string; /** Index of the grabbed handle, or null for the body. */ handle: number | null };

/** One series primitive that draws every drawing of the current source, the selection handles and the draft. */
export class DrawingPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<'Candlestick'> | null = null;
  private requestUpdate: (() => void) | null = null;
  /** Unsubscribes from the glyph sets and images finishing to load (a glyph drawn as a placeholder is painted again). */
  private stopGlyphs: (() => void) | null = null;
  private drawings: Drawing[] = [];
  private draft: Drawing | null = null;
  private measure: Drawing | null = null;
  private skipId: string | null = null;
  private selected: ReadonlySet<string> = new Set();
  private hovered: string | null = null;
  private pinned: ReadonlySet<string> = new Set();
  private box: Rect | null = null;
  private axisViews: ISeriesPrimitiveAxisView[] = [];
  private timeViews: ISeriesPrimitiveAxisView[] = [];
  private readonly view: IPrimitivePaneView;

  /**
   * `getTimeframe` is the chart's timeframe (a drawing can be hidden on some kinds of it) and `getDefaults` the user's
   * saved default style per tool.
   */
  constructor(
    private readonly getTimes: () => readonly number[],
    private readonly getTimeframe: () => string = () => '',
    private readonly getDefaults: () => Readonly<Record<string, Record<string, unknown>>> = () => ({}),
    /** The loaded bars (ascending), for tools that read them. */
    private readonly getCandles: () => readonly OhlcBar[] = () => [],
  ) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target: RenderTarget) => this.paint(target),
    };
    this.view = { zOrder: () => 'top', renderer: () => renderer };
  }

  /** The series the drawings sit on (for price to pixel conversion), or null when detached. */
  priceSeries(): ISeriesApi<'Candlestick'> | null {
    return this.series;
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.series = p.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = p.requestUpdate;
    this.stopGlyphs = onGlyphLoaded(() => this.requestUpdate?.());
    this.rebuildAxisViews();
  }

  detached(): void {
    this.stopGlyphs?.();
    this.stopGlyphs = null;
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  /** `measure` is the finished temporary measure; `skipId` is a note not painted because its text is being edited. */
  set(
    drawings: Drawing[],
    selected: readonly string[],
    draft: Drawing | null,
    measure: Drawing | null = null,
    skipId: string | null = null,
  ): void {
    this.drawings = drawings;
    this.selected = new Set(selected);
    this.draft = draft;
    this.measure = measure;
    this.skipId = skipId;
    this.rebuildAxisViews();
    this.requestUpdate?.();
  }

  /** Lock all drawings: none shows or hits a handle (each drawing's own lock flag is untouched). */
  private lockAll = false;
  setLockAll(on: boolean): void {
    if (this.lockAll === on) return;
    this.lockAll = on;
    this.requestUpdate?.();
  }

  /** The drawing the pointer is on and the ones pinned open: their tools' popups show (as the selected one's does). */
  setPopups(hovered: string | null, pinned: ReadonlySet<string>): void {
    this.hovered = hovered;
    this.pinned = pinned;
    this.requestUpdate?.();
  }

  /** Whether a drawing's popup is open: it is hovered, selected or pinned. */
  private popupOpen(d: Drawing): boolean {
    return d.id === this.hovered || this.selected.has(d.id) || this.pinned.has(d.id);
  }

  /** The selection box being dragged (chart pixels), or null. */
  setBox(rect: Rect | null): void {
    this.box = rect;
    this.requestUpdate?.();
  }

  /** The ids of the shown drawings whose placed points all lie in the box (a price-only tool by y alone, a time-only tool by x alone). */
  idsInBox(rect: Rect): string[] {
    const out: string[] = [];
    for (const d of this.drawings) {
      if (!this.shown(d)) continue;
      const tool = getTool(d.tool);
      const pts = tool && this.points(d);
      if (pts && inBox(pts, rect, { ignoreX: tool.priceOnly === true, ignoreY: tool.timeOnly === true })) out.push(d.id);
    }
    return out;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.axisViews;
  }

  timeAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return this.timeViews;
  }

  updateAllViews(): void {
    this.rebuildAxisViews();
  }

  /**
   * Chart pixels of an anchor of a tool, or null when it cannot be placed (no data, off the scales). A pane-anchored
   * tool's anchor is a pair of pane fractions; a tool that spans the pane's width or height places even off the scale.
   */
  toPoint(a: Anchor, tool?: DrawingTool): Pt | null {
    if (!this.chart || !this.series) return null;
    if (tool?.paneAnchored) {
      const { width, height } = this.chart.paneSize(0);
      return fractionToPoint(a, width, height);
    }
    const anyX = tool?.priceOnly === true || tool?.fullWidth === true;
    const anyY = tool?.timeOnly === true || tool?.fullHeight === true;
    const x = this.chart.timeScale().logicalToCoordinate(timeToLogical(this.getTimes(), a.time) as never);
    let y: number | null = this.series.priceToCoordinate(a.price);
    // A tool that spans the width (horizontal line) still places when its time is off the scale, and one that
    // spans the height (vertical line) when its price is: that coordinate is clamped into the pane.
    if (y === null && anyY) y = this.clampedY(a.price);
    if (y === null || (x === null && !anyX)) return null;
    return { x: x ?? 0, y };
  }

  /** The pane edge a price off the scale lies beyond, or null when there is no scale to tell. */
  private clampedY(price: number): number | null {
    if (!this.chart || !this.series) return null;
    const height = this.chart.paneSize(0).height;
    const top = this.series.coordinateToPrice(0);
    const bottom = this.series.coordinateToPrice(height);
    if (top === null || bottom === null) return height / 2;
    return price >= Math.max(top, bottom) === top >= bottom ? 0 : height;
  }

  /** Anchor under a chart pixel, or null; for a pane-anchored tool the pane fractions, clamped onto the pane. */
  toAnchor(p: Pt, tool?: DrawingTool): Anchor | null {
    if (!this.chart || !this.series) return null;
    if (tool?.paneAnchored) {
      const { width, height } = this.chart.paneSize(0);
      return pointToFraction(p, width, height);
    }
    const times = this.getTimes();
    if (times.length === 0) return null;
    const logical = this.chart.timeScale().coordinateToLogical(p.x);
    const price = this.series.coordinateToPrice(p.y);
    if (logical === null || price === null) return null;
    return { time: tool?.barTime ? barSlotTime(times, logical) : logicalToTime(times, logical), price };
  }

  private points(d: Drawing): Pt[] | null {
    const pts: Pt[] = [];
    const tool = getTool(d.tool);
    for (const a of d.anchors) {
      const pt = this.toPoint(a, tool);
      if (!pt) return null;
      pts.push(pt);
    }
    return pts;
  }

  /** A drawing's effective style: its own values, else the user's default for its tool, else the tool's. */
  private styleOf(d: Pick<Drawing, 'tool' | 'style'>) {
    const tool = getTool(d.tool);
    const defaults = this.getDefaults();
    const own = Object.prototype.hasOwnProperty.call(defaults, d.tool) ? defaults[d.tool] : undefined;
    return resolveStyle(tool?.settings ?? [], d.style, own);
  }

  /** Whether the drawing shows on the chart's current timeframe; a drawing of an unknown tool or a hidden one never does. */
  shown(d: Pick<Drawing, 'tool' | 'style'> & Partial<Pick<Drawing, 'hidden'>>): boolean {
    return d.hidden !== true && !!getTool(d.tool) && visibleOn(this.styleOf(d).values, timeframeKind(this.getTimeframe()));
  }

  /** The view context a tool sees for a drawing's anchors; the pane size comes from the chart unless given. */
  viewFor(d: Pick<Drawing, 'tool' | 'anchors'> & Partial<Pick<Drawing, 'text' | 'style' | 'cells' | 'image' | 'glyph'>>, size?: { width: number; height: number }): ToolView {
    const series = this.series;
    const { values, styled } = this.styleOf(d);
    const pane = size ?? (this.chart ? this.chart.paneSize(0) : { width: 0, height: 0 });
    return {
      width: pane.width,
      height: pane.height,
      anchors: d.anchors,
      text: d.text ?? '',
      cells: d.cells ?? [],
      glyph: d.glyph ?? '',
      image: d.image,
      times: this.getTimes(),
      candles: this.getCandles(),
      priceToY: (price) => series?.priceToCoordinate(price) ?? null,
      formatPrice: (price) => series?.priceFormatter().format(price) ?? String(price),
      style: values,
      styled,
    };
  }

  /** What a press at p would grab: the selected drawing's handles first, then drawings from the top. */
  hit(p: Pt, opts: HitOpts = MOUSE_HIT): DrawingHit | null {
    // Handles are only for a single selection.
    const sel = this.selected.size === 1 ? this.drawings.find((d) => this.selected.has(d.id) && this.shown(d)) : undefined;
    if (sel && !sel.locked && !this.lockAll) {
      const tool = getTool(sel.tool);
      const pts = tool && this.points(sel);
      if (tool && pts) {
        const hs = tool.handles(pts, this.viewFor(sel));
        for (let i = 0; i < hs.length; i++) if (hitsHandle(p, hs[i], opts.handleRadius)) return { id: sel.id, handle: i };
      }
    }
    // An open popup is painted over every drawing, so it is pressed first.
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (d.id === this.skipId || !this.popupOpen(d) || !this.shown(d)) continue;
      const tool = getTool(d.tool);
      const pts = tool?.popupHit && this.points(d);
      if (tool?.popupHit && pts && tool.popupHit(pts, p, this.viewFor(d), opts.tolerance)) return { id: d.id, handle: null };
    }
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (!this.shown(d)) continue;
      const tool = getTool(d.tool);
      const pts = tool && this.points(d);
      if (tool && pts && tool.hit(pts, p, this.viewFor(d), opts.tolerance)) return { id: d.id, handle: null };
    }
    return null;
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const h = this.hit({ x, y });
    return h ? { cursorStyle: 'pointer', externalId: h.id, zOrder: 'top' } : null;
  }

  private paint(target: RenderTarget): void {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const all = [...this.drawings, ...(this.measure ? [this.measure] : []), ...(this.draft ? [this.draft] : [])];
      for (const d of all) {
        if (d.id === this.skipId || !this.shown(d)) continue;
        const tool = getTool(d.tool);
        const pts = tool && this.points(d);
        if (!tool || !pts) continue;
        const selected = this.selected.has(d.id);
        ctx.save();
        const view = this.viewFor(d, mediaSize);
        tool.draw(ctx, pts, view, { selected });
        if (selected && this.selected.size === 1 && !d.locked && !this.lockAll) {
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
        if (d === this.draft) {
          // A draft with more than two anchors shows the ones placed so far as handles (the last still follows the
          // pointer). A two-anchor draft shows its first anchor only while the second is still on it (first tap placed).
          const [first, second] = d.anchors;
          const placed = anchorRange(tool.anchors).max > 2 ? d.anchors.length - 1 : first.time === second.time && first.price === second.price ? 1 : 0;
          for (const p0 of pts.slice(0, placed)) {
            ctx.beginPath();
            ctx.arc(p0.x, p0.y, HANDLE_RADIUS, 0, Math.PI * 2);
            ctx.fillStyle = theme.bg;
            ctx.fill();
            ctx.lineWidth = 2;
            ctx.strokeStyle = theme.text;
            ctx.stroke();
          }
        }
        ctx.restore();
      }
      // Popups last, so no drawing covers one.
      for (const d of this.drawings) {
        if (d.id === this.skipId || !this.popupOpen(d) || !this.shown(d)) continue;
        const tool = getTool(d.tool);
        const pts = tool?.popup && this.points(d);
        if (!tool?.popup || !pts) continue;
        ctx.save();
        tool.popup(ctx, pts, this.viewFor(d, mediaSize));
        ctx.restore();
      }
      const box = this.box;
      if (box) {
        ctx.save();
        ctx.fillStyle = 'rgba(96, 165, 250, 0.15)';
        ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = theme.accent2;
        ctx.strokeRect(box.left + 0.5, box.top + 0.5, box.right - box.left, box.bottom - box.top);
        ctx.restore();
      }
    });
  }

  /** The labels each drawing shows on the axes, as its tool declares them (the selected drawing's anchors, a horizontal line's price). */
  private rebuildAxisViews(): void {
    const series = this.series;
    const chart = this.chart;
    if (!series || !chart) {
      this.axisViews = [];
      this.timeViews = [];
      return;
    }
    const price: ISeriesPrimitiveAxisView[] = [];
    const time: ISeriesPrimitiveAxisView[] = [];
    for (const d of this.drawings) {
      const tool = getTool(d.tool);
      if (!tool?.axisLabels) continue;
      const { values } = this.styleOf(d);
      const labels = tool.axisLabels(d.anchors, values, this.selected.size === 1 && this.selected.has(d.id), this.getTimes());
      const back = () => cssColor(values.labelColor ?? theme.accent2);
      for (const p of labels.price ?? []) {
        price.push({
          coordinate: () => series.priceToCoordinate(p) ?? -1000,
          text: () => series.priceFormatter().format(p),
          textColor: () => '#09090b',
          backColor: back,
          visible: () => this.shown(d) && series.priceToCoordinate(p) !== null,
        });
      }
      for (const t of labels.time ?? []) {
        time.push({
          coordinate: () => chart.timeScale().logicalToCoordinate(timeToLogical(this.getTimes(), t) as never) ?? -1000,
          text: () => {
            const fmt = chart.options().localization.timeFormatter;
            return fmt ? fmt(t as Time) : String(t);
          },
          textColor: () => '#09090b',
          backColor: back,
          visible: () => this.shown(d) && chart.timeScale().logicalToCoordinate(timeToLogical(this.getTimes(), t) as never) !== null,
        });
      }
    }
    this.axisViews = price;
    this.timeViews = time;
  }
}
