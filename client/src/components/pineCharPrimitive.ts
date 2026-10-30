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
import type { PineCharDesc } from '../lib/pine/chartSeries';

/** Gap between the anchor (the bar's high or low) and the glyph. */
const MARGIN = 4;
/** Gap between a glyph and its text. */
const TEXT_GAP = 1;

export interface CharPlacement {
  glyphY: number;
  textY: number | null;
  textPx: number;
}

/**
 * Vertical placement of a glyph (centre) and its text (centre) around the anchor's y. A glyph above the anchor
 * has its text above it, one below has the text below, a centred one has the text under it.
 */
export function placeChar(y: number, align: PineCharDesc['align'], fontPx: number, hasText: boolean, height = Infinity): CharPlacement {
  const p = placeUnclamped(y, align, fontPx, hasText);
  // Kept inside the pane, so a glyph at the very top or bottom of a script's own pane is not cut off.
  const keep = (v: number, px: number) => Math.min(Math.max(v, px / 2), height - px / 2);
  const glyphY = keep(p.glyphY, fontPx);
  const shifted = p.textY === null ? null : p.textY + (glyphY - p.glyphY);
  return { glyphY, textY: shifted === null ? null : keep(shifted, p.textPx), textPx: p.textPx };
}

function placeUnclamped(y: number, align: PineCharDesc['align'], fontPx: number, hasText: boolean): CharPlacement {
  const textPx = Math.max(9, Math.round(fontPx * 0.7));
  const step = fontPx / 2 + TEXT_GAP + textPx / 2;
  if (align === 'above') {
    const glyphY = y - MARGIN - fontPx / 2;
    return { glyphY, textY: hasText ? glyphY - step : null, textPx };
  }
  if (align === 'below') {
    const glyphY = y + MARGIN + fontPx / 2;
    return { glyphY, textY: hasText ? glyphY + step : null, textPx };
  }
  return { glyphY: y, textY: hasText ? y + step : null, textPx };
}

/**
 * The plotchar() glyphs of one pane: each character drawn in the plot's colour at its bar, with its text beside
 * it. Attached to the pane's invisible carrier series, whose scale places the anchors.
 */
export class PineCharPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private chars: readonly PineCharDesc[] = [];
  private readonly view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = { draw: (target) => this.paint(target) };
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

  setData(chars: readonly PineCharDesc[]): void {
    this.chars = chars;
    this.requestUpdate?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  private paint(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    const { chart, series, chars } = this;
    if (!chart || !series || chars.length === 0) return;
    const scale = chart.timeScale();
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const c of chars) {
        const x = scale.timeToCoordinate(c.time as Time);
        const y = series.priceToCoordinate(c.price);
        if (x === null || y === null || x < -c.fontPx || x > mediaSize.width + c.fontPx) continue;
        const at = placeChar(y, c.align, c.fontPx, Boolean(c.text), mediaSize.height);
        ctx.fillStyle = c.color;
        ctx.font = `${c.fontPx}px sans-serif`;
        ctx.fillText(c.char, x, at.glyphY);
        if (c.text && at.textY !== null) {
          ctx.font = `${at.textPx}px sans-serif`;
          ctx.fillText(c.text, x, at.textY);
        }
      }
    });
  }
}
