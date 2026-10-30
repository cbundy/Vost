import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import { fillPolygons, type FillBar } from '../lib/pine/fillGeometry';

export interface PineFillData {
  times: readonly number[];
  /** Value of each side per candle, null for na (same length as `times`). */
  v1: readonly (number | null)[];
  v2: readonly (number | null)[];
  /** Base colour and the per-candle colours where they vary. */
  color: string;
  colors?: readonly (string | null)[];
}

/**
 * The shaded area of a Pine fill(). Attached to the first series it joins and reads the other one for its
 * coordinates; drawn beneath the lines and without autoscale info, so it never changes the pane's scale.
 */
export class PineFillPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private data: PineFillData | null = null;
  private readonly view: IPrimitivePaneView;

  constructor(private readonly other: ISeriesApi<SeriesType>) {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => this.paint(target),
    };
    this.view = { zOrder: () => 'bottom', renderer: () => renderer };
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

  setData(data: PineFillData): void {
    this.data = data;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  private paint(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    const { chart, series, data, other } = this;
    if (!chart || !series || !data) return;
    const scale = chart.timeScale();
    const bars: FillBar[] = data.times.map((t, i) => {
      const a = data.v1[i];
      const b = data.v2[i];
      const x = scale.timeToCoordinate(t as Time);
      const y1 = a === null ? null : series.priceToCoordinate(a);
      const y2 = b === null ? null : other.priceToCoordinate(b);
      return { x, y1, y2, color: data.colors?.[i] ?? data.color };
    });
    const polygons = fillPolygons(bars);
    if (polygons.length === 0) return;
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      for (const poly of polygons) {
        ctx.beginPath();
        poly.points.forEach((pt, i) => (i === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
        ctx.closePath();
        ctx.fillStyle = poly.color;
        ctx.fill();
      }
    });
  }
}
