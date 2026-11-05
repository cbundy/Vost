/** The strategy maker's own series primitive: one shaded band per marked trade, over the bars it spans. */
import type {
  IChartApiBase,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts';
import { theme } from '../lib/theme';
import type { HighlightTrade } from './brush';

export class TradeBands implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private requestUpdate: (() => void) | null = null;
  private bands: readonly HighlightTrade[] = [];
  private preview: HighlightTrade | null = null;
  private readonly view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => target.useMediaCoordinateSpace(({ context, mediaSize }) => this.paint(context, mediaSize.height)),
    };
    this.view = { zOrder: () => 'bottom', renderer: () => renderer };
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.chart = p.chart;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.chart = null;
    this.requestUpdate = null;
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  setTrades(trades: readonly HighlightTrade[]): void {
    this.bands = trades;
    this.requestUpdate?.();
  }

  /** The stroke being painted, drawn lighter until the pointer is released. */
  setPreview(trade: HighlightTrade | null): void {
    this.preview = trade;
    this.requestUpdate?.();
  }

  private paint(ctx: CanvasRenderingContext2D, height: number): void {
    const chart = this.chart;
    if (!chart) return;
    const ts = chart.timeScale();
    const half = ts.options().barSpacing / 2;
    const draw = (t: HighlightTrade, alpha: number) => {
      const x1 = ts.timeToCoordinate(t.entryTime as Time);
      const x2 = ts.timeToCoordinate(t.exitTime as Time);
      if (x1 === null || x2 === null) return;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = t.side === 'long' ? theme.green : theme.red;
      ctx.fillRect(x1 - half, 0, x2 - x1 + half * 2, height);
    };
    for (const t of this.bands) draw(t, 0.18);
    if (this.preview) draw(this.preview, 0.3);
    ctx.globalAlpha = 1;
  }
}
