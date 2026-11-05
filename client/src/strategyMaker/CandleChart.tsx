import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef } from 'react';
import type { Candle } from '../../../shared/market.ts';
import { DOWN_COLOR, UP_COLOR, chartTheme, theme } from '../lib/theme';
import { strokeTrade, type HighlightTrade, type Tool } from './brush';
import { FoundMarks } from './foundMarks';
import type { FoundTrade } from './run';
import { TradeBands } from './tradeBands';

export interface FocusRequest {
  trade: HighlightTrade;
  /** A new object each click, so the same row can be clicked twice. */
  nonce: number;
}

interface Props {
  candles: Candle[];
  trades: readonly HighlightTrade[];
  tool: Tool | null;
  /** A finished stroke, from bar index a to bar index b (the page decides what the tool does with it). */
  onStroke: (a: number, b: number) => void;
  focus: FocusRequest | null;
  /** The trades of a found strategy, drawn as outlines beside the user's bands. */
  foundTrades?: readonly FoundTrade[];
}

/** The strategy maker's own candle chart: it pans, zooms and resizes with its box, and paints marked trades. */
const NO_FOUND: readonly FoundTrade[] = [];

export function CandleChart({ candles, trades, tool, onStroke, focus, foundTrades = NO_FOUND }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const bands = useRef(new TradeBands());
  const foundMarks = useRef(new FoundMarks());
  const latestFound = useRef(foundTrades);
  latestFound.current = foundTrades;
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const times = useMemo(() => candles.map((c) => c.time), [candles]);
  const live = useRef({ tool, onStroke, times });
  live.current = { tool, onStroke, times };
  const latest = useRef({ trades, tool });
  latest.current = { trades, tool };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: chartTheme.text, fontSize: 11 },
      grid: { vertLines: { color: chartTheme.grid }, horzLines: { color: chartTheme.grid } },
      rightPriceScale: { borderColor: chartTheme.scaleBorder },
      timeScale: { borderColor: chartTheme.scaleBorder, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: chartTheme.crosshair }, horzLine: { color: chartTheme.crosshair } },
      handleScroll: !latest.current.tool,
      handleScale: !latest.current.tool,
    });
    const series: ISeriesApi<'Candlestick'> = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
    });
    series.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    chart.timeScale().fitContent();
    const prim = bands.current;
    series.attachPrimitive(prim);
    prim.setTrades(latest.current.trades);
    series.attachPrimitive(foundMarks.current);
    foundMarks.current.setTrades(latestFound.current);
    const mk = createSeriesMarkers(series, markersFor(latest.current.trades));
    markers.current = mk;
    chartRef.current = chart;

    // Painting: pointer events on the chart box, only while a tool is active (the chart does not pan then).
    const indexAt = (e: PointerEvent): number => {
      const rect = el.getBoundingClientRect();
      const logical = chart.timeScale().coordinateToLogical(e.clientX - rect.left);
      return Math.round(logical ?? 0);
    };
    let start: number | null = null;
    let lo = 0;
    let hi = 0;
    let pointer = -1;
    const clampIdx = (i: number) => Math.max(0, Math.min(live.current.times.length - 1, i));
    const previewFor = (a: number, b: number): HighlightTrade | null => {
      const t = live.current.tool;
      if (!t) return null;
      if (t.kind === 'eraser') {
        const lo = clampIdx(Math.min(a, b));
        const hi = clampIdx(Math.max(a, b));
        return { side: 'short', entryTime: live.current.times[lo], exitTime: live.current.times[hi] };
      }
      return strokeTrade(live.current.times, a, b, t.side);
    };
    const down = (e: PointerEvent) => {
      if (!live.current.tool || (e.pointerType === 'mouse' && e.button !== 0)) return;
      start = indexAt(e);
      lo = hi = start;
      pointer = e.pointerId;
      el.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    const move = (e: PointerEvent) => {
      if (start === null || e.pointerId !== pointer) return;
      const i = indexAt(e);
      lo = Math.min(lo, i);
      hi = Math.max(hi, i);
      prim.setPreview(live.current.tool?.kind === 'eraser' ? previewFor(lo, hi) : previewFor(start, i));
    };
    const end = (e: PointerEvent, commit: boolean) => {
      if (start === null || e.pointerId !== pointer) return;
      const a = start;
      start = null;
      prim.setPreview(null);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      if (!commit || !live.current.tool) return;
      const i = indexAt(e);
      // An eraser removes every trade the drag passed over, not only between press and release.
      if (live.current.tool.kind === 'eraser') live.current.onStroke(Math.min(lo, i), Math.max(hi, i));
      else live.current.onStroke(a, i);
    };
    const up = (e: PointerEvent) => end(e, true);
    const cancel = (e: PointerEvent) => end(e, false);
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      markers.current = null;
      chartRef.current = null;
      chart.remove();
    };
  }, [candles]);

  // Trades change the bands and markers only; the chart is not rebuilt.
  useEffect(() => {
    bands.current.setTrades(trades);
    markers.current?.setMarkers(markersFor(trades));
  }, [trades]);

  useEffect(() => {
    foundMarks.current.setTrades(foundTrades);
  }, [foundTrades]);

  // A tool turns the chart's own pan and zoom off, and back on when it is left.
  useEffect(() => {
    chartRef.current?.applyOptions({ handleScroll: !tool, handleScale: !tool });
  }, [tool]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!focus || !chart) return;
    const from = times.findIndex((t) => t >= focus.trade.entryTime);
    const lastIdx = times.findIndex((t) => t > focus.trade.exitTime);
    const to = lastIdx === -1 ? times.length - 1 : lastIdx - 1;
    if (from === -1) return;
    const pad = Math.max(10, (to - from) * 0.5);
    chart.timeScale().setVisibleLogicalRange({ from: from - pad, to: to + pad });
  }, [focus]);

  return <div ref={ref} className={`sm-chart${tool ? ' sm-chart-tool' : ''}`} role="img" aria-label="Candle chart" />;
}

function markersFor(trades: readonly HighlightTrade[]): SeriesMarker<Time>[] {
  const out: SeriesMarker<Time>[] = [];
  for (const t of trades) {
    const long = t.side === 'long';
    const color = long ? theme.green : theme.red;
    out.push({ time: t.entryTime as Time, position: long ? 'belowBar' : 'aboveBar', shape: long ? 'arrowUp' : 'arrowDown', color, text: 'in' });
    out.push({ time: t.exitTime as Time, position: long ? 'aboveBar' : 'belowBar', shape: 'circle', color, text: 'out' });
  }
  return out.sort((x, y) => (x.time as number) - (y.time as number));
}
