/**
 * Pure mapping from a Pine run (PineResult) to chart series descriptions.
 * No chart library imports: ChartPanel's pine hook turns these into series.
 */
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
  /** circles/cross styles: markers only, no connecting line. */
  pointsOnly?: boolean;
  /** bgcolor: full-height band drawn on its own 0..1 scale. */
  band?: boolean;
  data: PineSeriesPoint[];
}

export interface PineMarkerDesc {
  time: number;
  position: 'aboveBar' | 'belowBar' | 'inBar';
  shape: 'arrowUp' | 'arrowDown' | 'circle' | 'square';
  color: string;
  text?: string;
  size: number;
}

export interface PineChartModel {
  series: PineSeriesDesc[];
  /** Always drawn on the price pane. */
  markers: PineMarkerDesc[];
}

const UP = '#22c55e';
const DOWN = '#ef4444';
const EXIT = 'rgba(139,148,167,0.9)';

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

export function buildPineChart(result: PineResult, candles: Candle[], fallbackColor: string): PineChartModel {
  const series: PineSeriesDesc[] = [];
  const markers: PineMarkerDesc[] = [];

  result.plots.forEach((plot, idx) => {
    const key = `${idx}_${plot.name}`;
    const color = cssColor(plot.color, fallbackColor);
    const pane = plot.pane;
    if (plot.kind === 'hline') {
      const level = plot.values.find((v): v is number => v !== null && Number.isFinite(v));
      if (level === undefined) return;
      series.push({
        key, title: plot.name, type: 'line', pane, color, lineWidth: 1, dashed: true,
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
        if (!plot.values[i]) return;
        markers.push({
          time: c.time,
          position: location(plot.location),
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

  for (const t of result.trades) {
    const long = t.direction === 'long';
    markers.push({
      time: t.entryTime,
      position: long ? 'belowBar' : 'aboveBar',
      shape: long ? 'arrowUp' : 'arrowDown',
      color: long ? UP : DOWN,
      text: long ? 'L' : 'S',
      size: 1,
    });
    if (t.exitTime !== null) {
      markers.push({ time: t.exitTime, position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color: EXIT, size: 0.6 });
    }
  }
  markers.sort((a, b) => a.time - b.time);
  return { series, markers };
}
