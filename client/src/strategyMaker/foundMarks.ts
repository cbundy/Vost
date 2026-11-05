/** Series primitive for the trades a found strategy takes: outlined markers and a dashed line, never filled bands. */
import type { ISeriesApi, ISeriesPrimitive, IPrimitivePaneRenderer, IPrimitivePaneView, SeriesAttachedParameter, SeriesType, Time } from 'lightweight-charts';
import { theme } from '../lib/theme';
import type { FoundTrade } from './run';

export const FOUND_COLOR = theme.amber;

export class FoundMarks implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType, Time> | null = null;
  private chart: SeriesAttachedParameter<Time>['chart'] | null = null;
  private requestUpdate: (() => void) | null = null;
  private trades: readonly FoundTrade[] = [];
  private readonly view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => target.useMediaCoordinateSpace(({ context }) => this.paint(context)),
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

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  setTrades(trades: readonly FoundTrade[]): void {
    this.trades = trades;
    this.requestUpdate?.();
  }

  private paint(ctx: CanvasRenderingContext2D): void {
    const { chart, series } = this;
    if (!chart || !series) return;
    const ts = chart.timeScale();
    ctx.lineWidth = 2;
    ctx.strokeStyle = FOUND_COLOR;
    for (const t of this.trades) {
      const x1 = ts.timeToCoordinate(t.entryTime as Time);
      const x2 = ts.timeToCoordinate(t.exitTime as Time);
      const y1 = series.priceToCoordinate(t.entryPrice);
      const y2 = series.priceToCoordinate(t.exitPrice);
      if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash([]);
      // Entry: an outlined circle; exit: an outlined square.
      ctx.beginPath();
      ctx.arc(x1, y1, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeRect(x2 - 5, y2 - 5, 10, 10);
    }
  }
}
