import type { ISeriesApi, ISeriesPrimitive, ISeriesPrimitiveAxisView, SeriesAttachedParameter, Time } from 'lightweight-charts';
import { barCountdownSeconds, fmtCountdown } from '../../lib/barCountdown';

export type CountdownBar = { time: number; close: number; up: boolean; color?: string };

/** The height of a price-scale label, so the countdown sits right under the last-price label. */
export const LABEL_HEIGHT = 20;

/** Dark text on a light colour, else white (as the chart's own last-price label picks). */
function textOn(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#000000' : '#ffffff';
}

/** A price-scale label under the last price: the time left in the last bar. */
export class CountdownPrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<'Candlestick'> | null = null;
  private requestUpdate: (() => void) | null = null;
  private readonly axisView: ISeriesPrimitiveAxisView;

  constructor(
    private readonly getBar: () => CountdownBar | null,
    private readonly getTimeframe: () => string,
    private readonly isEnabled: () => boolean,
    private readonly upColor: string,
    private readonly downColor: string,
    private readonly now: () => number = Date.now,
  ) {
    this.axisView = {
      coordinate: () => this.coordinate() ?? 0,
      text: () => this.text(),
      textColor: () => textOn(this.backColor()),
      backColor: () => this.backColor(),
      visible: () => this.visible(),
    };
  }

  attached(p: SeriesAttachedParameter<Time>): void {
    this.series = p.series as ISeriesApi<'Candlestick'>;
    this.requestUpdate = p.requestUpdate;
  }

  detached(): void {
    this.series = null;
    this.requestUpdate = null;
  }

  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] {
    return [this.axisView];
  }

  /** Repaint the label (its text changed with the clock). */
  tick(): void {
    this.requestUpdate?.();
  }

  private seconds(): number | null {
    const bar = this.getBar();
    return bar ? barCountdownSeconds(bar.time, this.getTimeframe(), this.now()) : null;
  }

  private coordinate(): number | null {
    const bar = this.getBar();
    if (!bar || !this.series) return null;
    const y = this.series.priceToCoordinate(bar.close);
    return y == null ? null : y + LABEL_HEIGHT;
  }

  private text(): string {
    const s = this.seconds();
    return s == null ? '' : fmtCountdown(s);
  }

  private backColor(): string {
    const bar = this.getBar();
    if (!bar) return this.upColor;
    return bar.color ?? (bar.up ? this.upColor : this.downColor);
  }

  private visible(): boolean {
    return this.isEnabled() && this.seconds() != null && this.coordinate() != null;
  }
}
