/**
 * Pure mapping from a Pine run (PineResult) to chart series descriptions.
 * No chart library imports: ChartPanel's pine hook turns these into series.
 */
import { DOWN_COLOR, UP_COLOR, chartTheme } from '../theme';
import type { Candle } from '../../types';
import type { PinePlot, PineResult } from './types';

export interface PineSeriesPoint {
  time: number;
  /** Absent for na: a whitespace point (gap), never a zero. */
  value?: number;
  color?: string;
}

export interface PineSeriesDesc {
  key: string;
  title: string;
  type: 'line' | 'histogram';
  pane: 'price' | 'separate';
  color: string;
  lineWidth: number;
  dashed?: boolean;
  /** hline(): a fixed level (its value is the level), not a plotted series. */
  hline?: true;
  /** circles/cross styles: markers only, no connecting line. */
  pointsOnly?: boolean;
  /** bgcolor: full-height band drawn on its own 0..1 scale. */
  band?: boolean;
  data: PineSeriesPoint[];
}

export interface PineMarkerDesc {
  time: number;
  /** Where the mark is drawn: the candles, or the script's own pane. */
  pane: 'price' | 'separate';
  /** Price pane: bar-anchored position. */
  position: 'aboveBar' | 'belowBar' | 'inBar';
  /** Separate pane: where the mark sits on the carrier's hidden 0..1 scale. */
  panePosition: 'atPriceTop' | 'atPriceBottom' | 'atPriceMiddle';
  /** Separate pane: the carrier price the mark is anchored to (1 top, 0 bottom, 0.5 middle). */
  price: number;
  /** Separate pane: `price` is a series value on the pane's own `right` scale, not the carrier's 0..1 scale. */
  onScale?: boolean;
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  color: string;
  text?: string;
  size: number;
}

/** A fill() between two series of the same pane, drawn by a primitive on the first one. */
export interface PineFillDesc {
  pane: 'price' | 'separate';
  /** Keys of the two series it joins. */
  key1: string;
  key2: string;
  /** Base colour, as CSS. */
  color: string;
  /** One colour per candle (CSS, null = the base colour) where they vary. */
  colors?: (string | null)[];
}

export interface PineChartModel {
  series: PineSeriesDesc[];
  /** Shaded areas between two of `series`; they add no series of their own. */
  fills: PineFillDesc[];
  /** Each mark carries its pane: shapes follow their plot, trade marks are on the price pane. */
  markers: PineMarkerDesc[];
}

const UP = UP_COLOR;
const DOWN = DOWN_COLOR;
const EXIT = chartTheme.exit;

/** lightweight-charts does not parse #RRGGBBAA, so turn it into rgba(). */
export function cssColor(c: string | null | undefined, fallback: string): string {
  if (!c) return fallback;
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(c.trim());
  if (!m) return c;
  const n = parseInt(m[1], 16);
  const a = Math.round((parseInt(m[2], 16) / 255) * 1000) / 1000;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function points(plot: PinePlot, candles: Candle[], base: string, perBarColor: boolean): PineSeriesPoint[] {
  return candles.map((c, i) => {
    const v = plot.values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) return { time: c.time };
    const bar = plot.colors?.[i];
    return perBarColor && bar ? { time: c.time, value: v, color: cssColor(bar, base) } : { time: c.time, value: v };
  });
}

function shapeMarker(shape: string | undefined): PineMarkerDesc['shape'] {
  const s = (shape ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (s.includes('up')) return 'arrowUp';
  if (s.includes('down')) return 'arrowDown';
  if (s.includes('square') || s.includes('diamond')) return 'square';
  return 'circle';
}

function location(loc: string | undefined): PineMarkerDesc['position'] {
  const l = (loc ?? '').toLowerCase();
  if (l === 'belowbar' || l === 'bottom') return 'belowBar';
  if (l === 'absolute') return 'inBar';
  return 'aboveBar';
}

/**
 * Where a mark sits in a script's own pane. An absolute location sits at the
 * plotted value on the pane's right scale; with no finite value it sits mid-pane.
 */
export function separatePosition(loc: string | undefined, value?: number | null): Pick<PineMarkerDesc, 'panePosition' | 'price' | 'onScale'> {
  const l = (loc ?? '').toLowerCase();
  if (l === 'absolute' && typeof value === 'number' && Number.isFinite(value)) return { panePosition: 'atPriceMiddle', price: value, onScale: true };
  if (l === 'belowbar' || l === 'bottom') return { panePosition: 'atPriceBottom', price: 0 };
  if (l === 'absolute') return { panePosition: 'atPriceMiddle', price: 0.5 };
  return { panePosition: 'atPriceTop', price: 1 };
}

export function buildPineChart(result: PineResult, candles: Candle[], fallbackColor: string): PineChartModel {
  const series: PineSeriesDesc[] = [];
  const markers: PineMarkerDesc[] = [];
  const fills: PineFillDesc[] = [];
  const keyOf = (idx: number) => `${idx}_${result.plots[idx].name}`;

  result.plots.forEach((plot, idx) => {
    const key = keyOf(idx);
    const color = cssColor(plot.color, fallbackColor);
    const pane = plot.pane;
    if (plot.kind === 'fill') {
      // Resolved against the series actually emitted below, once all are known.
      return;
    }
    if (plot.kind === 'hline') {
      const level = plot.values.find((v): v is number => v !== null && Number.isFinite(v));
      if (level === undefined) return;
      series.push({
        key, title: plot.name, type: 'line', pane, color, lineWidth: 1, dashed: true, hline: true,
        data: candles.map((c) => ({ time: c.time, value: level })),
      });
      return;
    }
    if (plot.kind === 'bgcolor') {
      series.push({
        key, title: plot.name, type: 'histogram', pane, color, lineWidth: 1, band: true,
        data: candles.map((c, i) =>
          plot.values[i] ? { time: c.time, value: 1, color: cssColor(plot.colors?.[i], color) } : { time: c.time },
        ),
      });
      return;
    }
    if (plot.kind === 'plotshape') {
      candles.forEach((c, i) => {
        const abs = (plot.location ?? '').toLowerCase() === 'absolute';
        const v = plot.values[i];
        if (abs ? v === null || v === undefined || !Number.isFinite(v) : !v) return;
        markers.push({
          time: c.time,
          pane,
          position: location(plot.location),
          ...separatePosition(plot.location, plot.values[i]),
          shape: shapeMarker(plot.shape),
          color: cssColor(plot.colors?.[i], color),
          size: 1,
        });
      });
      return;
    }
    const histogram = plot.style === 'histogram' || plot.style === 'columns';
    series.push({
      key, title: plot.name,
      type: histogram ? 'histogram' : 'line',
      pane, color,
      lineWidth: 2,
      ...(!histogram && (plot.style === 'circles' || plot.style === 'cross') && { pointsOnly: true }),
      data: points(plot, candles, color, true),
    });
  });

  const emitted = new Set(series.map((d) => d.key));
  result.plots.forEach((plot, idx) => {
    if (plot.kind !== 'fill' || plot.plot1 === undefined || plot.plot2 === undefined) return;
    const key1 = result.plots[plot.plot1] && keyOf(plot.plot1);
    const key2 = result.plots[plot.plot2] && keyOf(plot.plot2);
    if (!key1 || !key2 || !emitted.has(key1) || !emitted.has(key2)) return;
    const color = cssColor(plot.color, fallbackColor);
    fills.push({
      pane: plot.pane, key1, key2, color,
      ...(plot.colors && { colors: candles.map((_, i) => (plot.colors![i] ? cssColor(plot.colors![i], color) : null)) }),
    });
  });

  for (const t of result.trades) {
    const long = t.direction === 'long';
    markers.push({
      time: t.entryTime,
      pane: 'price',
      panePosition: 'atPriceMiddle',
      price: 0.5,
      position: long ? 'belowBar' : 'aboveBar',
      shape: long ? 'arrowUp' : 'arrowDown',
      color: long ? UP : DOWN,
      text: long ? 'L' : 'S',
      size: 1,
    });
    if (t.exitTime !== null) {
      markers.push({ time: t.exitTime, pane: 'price', panePosition: 'atPriceMiddle', price: 0.5, position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: EXIT, size: 0.6 });
    }
  }
  markers.sort((a, b) => a.time - b.time);
  return { series, fills, markers };
}
