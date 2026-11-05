import { DOWN_COLOR, UP_COLOR, chartTheme, theme } from '../lib/theme';
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type ISeriesMarkersPluginApi,
  type LineWidth,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { candlesToCsv, downloadDataUrl, downloadFile, sanitizeFileName } from '../lib/export';
import { fmtTime } from '../lib/format';
import { legendHtml } from '../lib/legend';
import { ChartContextMenu } from './ChartContextMenu';
import { ChartRangeBar } from './ChartRangeBar';
import { fmtTick } from '../lib/time';
import { newPaneState, releasePanes, sizePanes, usePaneLegends, type OverlayReg, type PaneReg, type PaneState } from './usePaneLegends';
import { INDICATOR_META, computeIndicator, hexToRgba, type ComputedSeries, type IndicatorSpec } from '../lib/indicatorCompute';
import { seriesFormat, styledBuiltin, withOpacity, type StyledBuiltin } from '../lib/plotStyle';
import { indicatorDrawn } from '../lib/indicatorSettings';
import { getProvider } from '../lib/providers';
import { useStore } from '../state/store';
import { canPageOlder, selectDataCandles } from '../state/chart';
import { IndicatorSettingsDialog } from './IndicatorSettingsDialog';
import { PaneLegendActions, PriceLegendRows } from './IndicatorLegend';
import { builtinParams, priceLegendRows } from '../lib/paneLegend';
import { usePineSeries } from './usePineSeries';
import { useBarCountdown } from './chart/useBarCountdown';
import { usePriceScale } from './chart/usePriceScale';
import { PriceScaleButtons } from './PriceScaleButtons';
import { mergeBarColors, sameBarColors } from '../lib/pine/barColors';
import { useDrawings } from './chart/useDrawings';
import { DrawingTextEditor } from './DrawingTextEditor';
import { DrawingToolbar } from './DrawingToolbar';
import { DrawingSettingsDialog } from './DrawingSettingsDialog';
import { IconPicker } from './IconPicker';
import { isGlyphKind } from '../lib/iconSets/types';
import { DrawingMenu, DrawingRail, type DrawingControls } from './DrawingRail';
import { FavoritesBar } from './FavoritesBar';
import { useMediaQuery } from '../lib/useMediaQuery';
import { historyNeededFrom, resetLogicalRange, resetRangeKey } from '../lib/quickRange';
import { HISTORY_PREFETCH_BARS } from '../lib/historyPaging';
import { carriedView, isAssetSwitch, windowBars, type SeriesIdentity } from '../lib/carryView';
import { MIN_RANGE_BARS } from '../lib/timeRange';
import { useChart, useChartStore } from '../state/chartContext';
import { barTimeAt, drivesTime, publishCrosshair, publishTimeRange, sameTimeRange, setHovered, subscribe, type TimeRangeSync } from '../lib/layoutSync';

type IndEntry = {
  series: ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | ISeriesApi<'Area'>;
  kind: ComputedSeries['kind'];
};

const RIGHT_OFFSET = 3;
const LINE_STYLE = { solid: LineStyle.Solid, dashed: LineStyle.Dashed, dotted: LineStyle.Dotted } as const;
const UP = UP_COLOR;
const DOWN = DOWN_COLOR;

function toCandleData(c: { time: number; open: number; high: number; low: number; close: number }, barColors?: Map<number, string>) {
  const color = barColors?.get(c.time);
  return {
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    ...(color && { color, wickColor: color, borderColor: color }),
  };
}

function mapIndicatorPoint(st: StyledBuiltin, point: { time: number; value?: number; color?: string }) {
  const time = point.time as UTCTimestamp;
  if (point.value === undefined) return { time };
  if (st.type === 'histogram') return { time, value: point.value, color: point.color ?? st.color };
  return { time, value: point.value };
}

/** The series of `spec` as drawn under its style; the bar times are only read when a style is set. */
function styledSeries(spec: IndicatorSpec, candles: ReadonlyArray<{ time: number }>) {
  const times = spec.style ? candles.map((c) => c.time) : [];
  return computeIndicator(spec, candles as never).map((cs) => ({ cs, st: styledBuiltin(cs, spec.style, times) }));
}

export function ChartPanel({
  onImportCsv,
  onAddAlert,
  active = true,
}: {
  onImportCsv: () => void;
  onAddAlert: (level: number) => void;
  /** Whether this is the chart the top bar acts on: only that chart takes the drawing keyboard shortcuts. */
  active?: boolean;
}) {
  const chartStore = useChartStore();
  const candles = useChart((s) => s.candles);
  const dataKey = useChart((s) => s.dataKey);
  const dataLabel = useChart((s) => s.dataLabel);
  const indicators = useChart((s) => s.indicators);
  const btResult = useChart((s) => s.btResult);
  const showTrades = useChart((s) => s.showTrades);
  const setShowTrades = useChart((s) => s.setShowTrades);
  const priceScaleMode = useChart((s) => s.priceScaleMode);
  const setPriceScaleMode = useChart((s) => s.setPriceScaleMode);
  const loadState = useChart((s) => s.loadState);
  const pineRuns = useChart((s) => s.pineRuns);
  const providerId = useChart((s) => s.providerId);
  const setProvider = useChart((s) => s.setProvider);
  const timeZone = useStore((s) => s.timeZone);
  const timeframe = useChart((s) => s.timeframe);
  /** The indicators drawn at this timeframe: the one rule (see lib/indicatorSettings) every drawing site uses. */
  const drawn = useMemo(() => indicators.filter((i) => indicatorDrawn(i, timeframe)), [indicators, timeframe]);
  const replayPhase = useChart((s) => s.replay?.phase ?? null);
  /** During replay: the last visible bar's time, the cut-off for trade markers and Pine output. */
  const replayCutoff = replayPhase === 'active' ? (candles[candles.length - 1]?.time ?? null) : null;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const indMapRef = useRef(new Map<string, IndEntry>());
  const lastDataKeyRef = useRef('');
  const lastLeftEdgeRef = useRef<number | null>(null);
  const lastSeriesRef = useRef<SeriesIdentity | null>(null);
  /** Set from an asset switch until its carried window is shown: the views in between are not scroll backs. */
  const carryingRef = useRef(false);
  const lastIndicatorsRef = useRef<unknown>(null);
  const lastCandlesRef = useRef<typeof candles | null>(null);
  const savedRangeRef = useRef<{ from: number; to: number } | null>(null);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const paneEpochRef = useRef(0);
  const paneStateRef = useRef<PaneState>(newPaneState());
  const paneLegendsRef = useRef<HTMLDivElement | null>(null);
  const legendRowsRef = useRef<HTMLDivElement | null>(null);
  /** The indicator whose settings dialog is open from a legend row. */
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const legendRows = useMemo(() => priceLegendRows(indicators, timeframe, pineRuns), [indicators, timeframe, pineRuns]);

  const precision = useMemo(() => {
    const last = candles[candles.length - 1];
    if (!last) return 2;
    const p = Math.abs(last.close);
    if (p >= 1000) return 2;
    if (p >= 1) return 2;
    if (p >= 0.01) return 4;
    return 6;
  }, [candles]);

  /* ---------------- create chart once ---------------- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: chartTheme.background },
        textColor: chartTheme.text,
        fontSize: 11,
        fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: chartTheme.grid },
        horzLines: { color: chartTheme.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: chartTheme.crosshair, labelBackgroundColor: chartTheme.crosshairLabel },
        horzLine: { color: chartTheme.crosshair, labelBackgroundColor: chartTheme.crosshairLabel },
      },
      rightPriceScale: { borderColor: chartTheme.scaleBorder },
      timeScale: {
        borderColor: chartTheme.scaleBorder,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: RIGHT_OFFSET,
        tickMarkFormatter: (t: Time, type: number) => fmtTick(t as number, type, useStore.getState().timeZone),
      },
      localization: {
        locale: 'en-US',
        timeFormatter: (t: Time) => fmtTime(t as number, { timeZone: useStore.getState().timeZone }),
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP,
      downColor: DOWN,
      borderVisible: false,
      wickUpColor: UP,
      wickDownColor: DOWN,
      priceLineWidth: 1,
      priceLineStyle: LineStyle.Dotted,
    });

    chart.panes()[0]?.setStretchFactor(1); // the price pane is 1; a new sub pane is DEFAULT_SUB_FACTOR of it
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    markersRef.current = createSeriesMarkers(candleSeries, []);
    setChartApi(chart);

    return () => {
      markersRef.current = null;
      candleSeriesRef.current = null;
      chartRef.current = null;
      indMapRef.current.clear();
      setChartApi(null);
      chart.remove();
    };
  }, []);

  /* ---------------- price precision ---------------- */
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;
    series.applyOptions({
      priceFormat: { type: 'price', precision, minMove: Number(`1e-${precision}`) },
    });
  }, [precision]);

  /* ---------------- rebuild indicator series ---------------- */
  useEffect(() => {
    const chart = chartApi;
    if (!chart) return;
    paneEpochRef.current++; // panes are dropped below: pine series must be rebuilt
    // Keep the sizes the user dragged the sub panes to, per indicator id, before removing series empties and drops them.
    releasePanes(chart, paneStateRef.current, 'all', new Set(indicators.map((i) => i.id)));
    paneStateRef.current.overlays.clear(); // the Pine ones are rebuilt too: the epoch above says so

    for (const { series } of indMapRef.current.values()) {
      try {
        chart.removeSeries(series);
      } catch {
        /* already gone */
      }
    }
    indMapRef.current.clear();

    // Drop sub panes (they are re-created below in order).
    for (let i = chart.panes().length - 1; i >= 1; i--) {
      try {
        chart.removePane(i);
      } catch {
        /* pane busy */
      }
    }

    const visible = drawn;
    const subCount = visible.filter((s) => s.kind === 'rsi' || s.kind === 'macd').length;
    for (let i = 0; i < subCount; i++) chart.addPane();
    sizePanes(
      chart,
      paneStateRef.current,
      visible.filter((s) => s.kind === 'rsi' || s.kind === 'macd').map((s, i) => ({ id: s.id, paneIndex: 1 + i })),
    );

    let subIdx = 0;
    for (const spec of visible) {
      const computed = computeIndicator(spec, chartStore.getState().candles);
      if (computed.length === 0) continue;
      let paneIndex = 0;
      if (computed[0].pane === 'sub') {
        paneIndex = 1 + subIdx;
        subIdx++;
      }
      const legendEntries: PaneReg['entries'] = [];
      const overlayEntries: OverlayReg['entries'] = [];
      const candleTimes = spec.style ? chartStore.getState().candles.map((c) => c.time) : [];
      for (const cs of computed) {
        const st = styledBuiltin(cs, spec.style, candleTimes);
        if (!st.visible) continue;
        const fmt = seriesFormat(spec.style, cs.pane !== 'volume');
        const priceLine = { priceLineVisible: st.priceLine, ...(st.priceLine && { priceLineColor: st.color }) };
        let series: IndEntry['series'];
        if (st.type === 'histogram') {
          series = chart.addSeries(
            HistogramSeries,
            {
              color: st.color,
              priceFormat: fmt.priceFormat ?? { type: cs.pane === 'volume' ? 'volume' : 'price' },
              priceScaleId: cs.pane === 'volume' ? 'volume' : 'right',
              lastValueVisible: fmt.lastValueVisible,
              ...priceLine,
            },
            paneIndex,
          );
          if (cs.pane === 'volume') {
            chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
          }
        } else if (st.type === 'area') {
          series = chart.addSeries(
            AreaSeries,
            {
              lineColor: st.color,
              topColor: withOpacity(st.color, 35),
              bottomColor: withOpacity(st.color, 0),
              lineWidth: st.width as LineWidth,
              lineStyle: LINE_STYLE[st.lineStyle],
              ...(fmt.priceFormat && { priceFormat: fmt.priceFormat }),
              lastValueVisible: fmt.lastValueVisible,
              crosshairMarkerVisible: false,
              priceScaleId: cs.pane === 'volume' ? 'volume' : 'right',
              ...priceLine,
            },
            paneIndex,
          );
          if (cs.pane === 'volume') {
            chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
          }
        } else {
          series = chart.addSeries(
            LineSeries,
            {
              color: st.color,
              lineWidth: st.width as LineWidth,
              lineStyle: LINE_STYLE[st.lineStyle],
              ...(st.type === 'step' && { lineType: LineType.WithSteps }),
              ...(st.type === 'circles' && { lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: st.width + 1 }),
              ...(fmt.priceFormat && { priceFormat: fmt.priceFormat }),
              lastValueVisible: fmt.lastValueVisible,
              crosshairMarkerVisible: false,
              priceScaleId: cs.pane === 'volume' ? 'volume' : 'right',
              ...priceLine,
            },
            paneIndex,
          );
          if (cs.pane === 'volume') {
            chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
          }
          for (const pl of cs.priceLines ?? []) {
            series.createPriceLine({
              price: pl.value,
              color: pl.color,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: true,
              title: '',
            });
          }
        }
        indMapRef.current.set(`${spec.id}|${cs.key}`, { series, kind: cs.kind });
        const entry = { title: cs.title, color: st.color, series: series as never, ...(cs.pane === 'volume' && { compact: true }) };
        if (cs.pane === 'sub') legendEntries.push(entry);
        else overlayEntries.push(entry);
      }
      // The status line's values can be turned off: the row keeps its name and buttons.
      const valuesOn = spec.style?.valuesInStatusLine !== false;
      const precision = spec.style?.precision;
      const shownOverlay = valuesOn ? overlayEntries : [];
      const shownLegend = valuesOn ? legendEntries : [];
      if (overlayEntries.length > 0) {
        // One plot: the row's name already says what it is.
        paneStateRef.current.overlays.set(spec.id, {
          id: spec.id,
          source: 'builtin',
          precision,
          entries: shownOverlay.length === 1 ? [{ ...shownOverlay[0], title: '' }] : shownOverlay,
        });
      }
      if (paneIndex > 0) {
        paneStateRef.current.panes.set(spec.id, {
          id: spec.id,
          source: 'builtin',
          paneIndex,
          name: INDICATOR_META[spec.kind].name,
          params: builtinParams(spec),
          precision,
          // One plot: the name already says what it is.
          entries: shownLegend.length === 1 ? [{ ...shownLegend[0], title: '' }] : shownLegend,
        });
      }
    }
  }, [chartApi, drawn]);

  usePineSeries(chartApi, drawn, pineRuns, paneEpochRef, replayCutoff, paneStateRef);
  /* barcolor() of the visible Pine scripts: kept as the same map while its content is unchanged. */
  const mergedBarColors = useMemo(() => mergeBarColors(drawn, pineRuns, replayCutoff), [drawn, pineRuns, replayCutoff]);
  const barColorsRef = useRef(mergedBarColors);
  if (!sameBarColors(barColorsRef.current, mergedBarColors)) barColorsRef.current = mergedBarColors;
  const barColors = barColorsRef.current;
  /** The colors the candle series was last sent. */
  const sentBarColorsRef = useRef<Map<number, string>>(barColors);
  const narrow = useMediaQuery('(max-width: 600px)');
  /* The crosshair lines follow the cursor kind (the price and time labels stay in every kind). */
  const cursorKind = useStore((s) => s.cursorKind);
  useEffect(() => {
    const lines = cursorKind === 'cross';
    chartApi?.applyOptions({ crosshair: { vertLine: { visible: lines }, horzLine: { visible: lines } } });
  }, [chartApi, cursorKind]);
  const lastBarRef = useRef({ candles, barColors });
  lastBarRef.current = { candles, barColors };
  useBarCountdown(chartApi, chartApi ? candleSeriesRef.current : null, () => {
    const { candles: cs, barColors: bc } = lastBarRef.current;
    const c = cs[cs.length - 1];
    return c ? { time: c.time, close: c.close, up: c.close >= c.open, color: bc.get(c.time) } : null;
  }, timeframe, replayPhase);
  const drawings = useDrawings(chartApi, chartApi ? candleSeriesRef.current : null, containerRef, active);

  /* Entering replay: remember the view before the data effect cuts the bars. Exit restores it (below). */
  useEffect(() => {
    if (replayPhase !== 'active' || !chartApi) return;
    const r = chartApi.timeScale().getVisibleLogicalRange();
    savedRangeRef.current = r ? { from: r.from, to: r.to } : null;
  }, [chartApi, replayPhase === 'active']);

  /* After an asset switch scrolled back: show the same time window, paging older bars in first when it starts before the first one. */
  async function showCarriedWindow(from: number, to: number, needFrom: number | null, key: string) {
    const chart = chartRef.current;
    if (!chart) return;
    const stale = () => chartStore.getState().dataKey !== key || chartRef.current !== chart;
    try {
      await carryWindow(chart, from, to, needFrom, stale);
    } finally {
      if (!stale()) carryingRef.current = false;
    }
  }

  async function carryWindow(chart: IChartApi, from: number, to: number, needFrom: number | null, stale: () => boolean) {
    const st = chartStore.getState();
    if (needFrom != null && canPageOlder(st, useStore.getState().historyLoading)) {
      await st.loadHistoryTo(needFrom);
      if (stale()) return;
    }
    // One frame later: a range set in the same frame as new or merged bars is overridden by the chart's own update for them.
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    if (stale()) return;
    const cs = chartStore.getState().candles;
    if (cs.length === 0) return;
    const start = Math.max(from, cs[0].time);
    lastLeftEdgeRef.current = null; // moving to the carried window is not a scroll back: do not page for it
    try {
      if (needFrom != null && windowBars(cs, start, to) < MIN_RANGE_BARS) chart.timeScale().fitContent();
      else chart.timeScale().setVisibleRange({ from: start as UTCTimestamp, to: to as UTCTimestamp });
    } catch {
      chart.timeScale().fitContent();
    }
    lastLeftEdgeRef.current = chart.timeScale().getVisibleLogicalRange()?.from ?? null;
  }

  /* Older bar time the timeframe's default window needs paged in, or null when none is needed or possible. */
  function defaultWindowNeed(st: ReturnType<typeof chartStore.getState>): number | null {
    return canPageOlder(st, useStore.getState().historyLoading) ? historyNeededFrom(resetRangeKey(timeframe), st.candles, timeZone) : null;
  }

  /* Page older bars in until the timeframe's window is covered, then show it (all data when it does not apply).
     Shared by Reset view and the load path; abandoned when another series loads meanwhile. */
  async function showDefaultWindow(key: string) {
    const chart = chartRef.current;
    if (!chart) return;
    const stale = () => chartStore.getState().dataKey !== key || chartRef.current !== chart;
    carryingRef.current = true;
    try {
      const need = defaultWindowNeed(chartStore.getState());
      if (need != null) {
        await chartStore.getState().loadHistoryTo(need);
        if (stale()) return;
      }
      // One frame later: a range set in the same frame as new or merged bars is overridden by the chart's own update for them.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      if (stale()) return;
      const cs = chartStore.getState().candles;
      if (cs.length === 0) return;
      lastLeftEdgeRef.current = null; // showing the window is not a scroll back: do not page for it
      const range = resetLogicalRange(timeframe, cs, timeZone, RIGHT_OFFSET);
      if (range) chart.timeScale().setVisibleLogicalRange(range);
      else chart.timeScale().fitContent();
      lastLeftEdgeRef.current = chart.timeScale().getVisibleLogicalRange()?.from ?? null;
    } finally {
      if (!stale()) carryingRef.current = false;
    }
  }

  /* ---------------- push data (full or incremental) ---------------- */
  useEffect(() => {
    const chart = chartApi;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries || candles.length === 0) return;

    const dataChanged = lastDataKeyRef.current !== dataKey;
    const indChanged = lastIndicatorsRef.current !== drawn;

    // One bar appended or the last bar changed: send just that bar. Any other change to the same data
    // (replay entering, stepping back, exiting, a merged backfill) replaces the bars without refitting.
    const prev = lastCandlesRef.current;
    // The view of the series being replaced, read before setData: an asset switch on the same timeframe carries it over.
    const ts = chart.timeScale();
    const oldLogical = dataChanged ? ts.getVisibleLogicalRange() : null;
    const oldTimes = dataChanged ? ts.getVisibleRange() : null;
    const oldLength = prev?.length ?? 0;
    const st0 = chartStore.getState();
    const series: SeriesIdentity = {
      providerId: st0.providerId,
      symbol: st0.symbol,
      timeframe: st0.timeframe,
      datasetId: st0.activeDatasetId ?? (st0.chartRange != null ? 'range' : null),
    };
    const incremental =
      !dataChanged &&
      prev != null &&
      prev.length > 0 &&
      candles.length - prev.length >= 0 &&
      candles.length - prev.length <= 1 &&
      candles[prev.length - 1].time === prev[prev.length - 1].time;
    lastCandlesRef.current = candles;

    // Older bars merged in at the start (a history page): the series is replaced and lightweight-charts keeps the view
    // anchored to the last bar, so the visible time window stays; the left edge may still be near the first bar.
    const prepended = !dataChanged && !incremental && prev != null && prev.length > 0 && candles[0].time < prev[0].time;

    if (dataChanged) {
      candleSeries.setData(candles.map((c) => toCandleData(c, barColors)));
      lastDataKeyRef.current = dataKey;
      lastLeftEdgeRef.current = null; // the fit below is not a scroll back: do not page for it
      carryingRef.current = false;
      const carried =
        oldLogical && isAssetSwitch(lastSeriesRef.current, series)
          ? carriedView({ logical: oldLogical, from: oldTimes ? Number(oldTimes.from) : null, to: oldTimes ? Number(oldTimes.to) : null, length: oldLength }, candles)
          : null;
      lastSeriesRef.current = series;
      if (carried?.kind === 'logical') {
        ts.setVisibleLogicalRange(carried.range);
        lastLeftEdgeRef.current = carried.range.from;
      } else if (carried) {
        carryingRef.current = true;
        void showCarriedWindow(carried.from, carried.to, carried.needFrom, dataKey);
      } else if (st0.chartRange != null) {
        ts.fitContent();
      } else {
        // A fresh series opens on the Reset view window; fit first so the chart is not blank while older bars page in.
        const needsPaging = defaultWindowNeed(chartStore.getState()) != null;
        const range = needsPaging ? null : resetLogicalRange(timeframe, candles, timeZone, RIGHT_OFFSET);
        if (range) {
          ts.setVisibleLogicalRange(range);
          lastLeftEdgeRef.current = range.from;
        } else {
          ts.fitContent();
          if (needsPaging) {
            carryingRef.current = true;
            void showDefaultWindow(dataKey);
          }
        }
      }
    } else if (incremental && sentBarColorsRef.current === barColors) {
      candleSeries.update(toCandleData(candles[candles.length - 1], barColors));
    } else {
      // Also when only the bar colors changed since the last send: the update path would recolor one bar.
      candleSeries.setData(candles.map((c) => toCandleData(c, barColors)));
    }

    if (dataChanged || indChanged || !incremental) {
      for (const spec of drawn) {
        for (const { cs, st } of styledSeries(spec, candles)) {
          const entry = indMapRef.current.get(`${spec.id}|${cs.key}`);
          if (!entry) continue;
          const data = st.data.map((p) => mapIndicatorPoint(st, p));
          (entry.series as ISeriesApi<'Line'>).setData(data as never);
        }
      }
      lastIndicatorsRef.current = drawn;
    } else {
      for (const spec of drawn) {
        for (const { cs, st } of styledSeries(spec, candles)) {
          const entry = indMapRef.current.get(`${spec.id}|${cs.key}`);
          if (!entry || st.data.length === 0) continue;
          const point = mapIndicatorPoint(st, st.data[st.data.length - 1]);
          (entry.series as ISeriesApi<'Line'>).update(point as never);
        }
      }
    }

    if (prepended && !carryingRef.current) {
      const r = chart.timeScale().getVisibleLogicalRange();
      lastLeftEdgeRef.current = r ? r.from : null;
      if (r && r.from < HISTORY_PREFETCH_BARS) void chartStore.getState().loadOlder(); // still near the left edge: the next page
    }

    sentBarColorsRef.current = barColors;
    updateLegend(candles[candles.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi, candles, dataKey, drawn]);

  /* A backtest or optimizer run that loaded older history asks the chart to show its range (once). */
  const viewRequest = useChart((s) => s.viewRequest);
  useEffect(() => {
    if (!chartApi || !viewRequest) return;
    // One frame later: a range set in the same frame as the merged bars is overridden by the chart's own update for them.
    const frame = requestAnimationFrame(() => {
      try {
        chartApi.timeScale().setVisibleRange({ from: viewRequest.from as UTCTimestamp, to: viewRequest.to as UTCTimestamp });
      } catch {
        /* no data to place the range on */
      }
      chartStore.getState().clearViewRequest();
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi, viewRequest]);

  /* Only the bar colors changed (new run, script hidden or removed, replay cutoff): re-send the bars, keep the view. */
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!chartApi || !candleSeries || candles.length === 0) return;
    if (sentBarColorsRef.current === barColors) return;
    sentBarColorsRef.current = barColors;
    candleSeries.setData(candles.map((c) => toCandleData(c, barColors)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi, barColors]);

  /* Scrolling or zooming back to within a page's reach of the first loaded bar asks for the next older page. */
  useEffect(() => {
    if (!chartApi) return;
    const ts = chartApi.timeScale();
    const onRange = (r: LogicalRange | null) => {
      if (!r || carryingRef.current) return;
      const prevFrom = lastLeftEdgeRef.current;
      lastLeftEdgeRef.current = r.from;
      // Only a move of the left edge toward older bars counts: a prepend shifts it right, a fresh fit is the first sample.
      if (prevFrom != null && r.from < prevFrom && r.from < HISTORY_PREFETCH_BARS) void chartStore.getState().loadOlder();
    };
    ts.subscribeVisibleLogicalRangeChange(onRange);
    return () => ts.unsubscribeVisibleLogicalRangeChange(onRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi]);

  /* Leaving replay: put the view back as it was (no refetch, no fitContent). */
  useEffect(() => {
    if (replayPhase === 'active' || !chartApi) return;
    const saved = savedRangeRef.current;
    savedRangeRef.current = null;
    if (saved) chartApi.timeScale().setVisibleLogicalRange(saved);
  }, [chartApi, replayPhase]);

  /* Picking a replay start: the next click on a bar starts the replay there. */
  useEffect(() => {
    const chart = chartApi;
    if (!chart || replayPhase !== 'picking') return;
    const onClick = (param: MouseEventParams<Time>) => {
      if (param.time == null) return;
      chartStore.getState().startReplayAt(param.time as number);
    };
    chart.subscribeClick(onClick);
    return () => chart.unsubscribeClick(onClick);
  }, [chartApi, replayPhase]);

  /* ---------------- legend (imperative, rAF-throttled) ---------------- */
  const legendRaf = useRef(0);
  function updateLegend(c: { time: number; open: number; high: number; low: number; close: number; volume: number } | null) {
    const el = legendRef.current;
    if (!el || !c) return;
    cancelAnimationFrame(legendRaf.current);
    legendRaf.current = requestAnimationFrame(() => {
      el.innerHTML = legendHtml(c, dataLabel, useStore.getState().timeZone);
    });
  }

  useEffect(() => {
    const chart = chartApi;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;
    const handler = (param: MouseEventParams<Time>) => {
      const data = param.seriesData.get(candleSeries) as
        | { open: number; high: number; low: number; close: number }
        | undefined;
      const state = chartStore.getState();
      const last = state.candles[state.candles.length - 1];
      if (!data || !param.time) {
        if (last) updateLegend(last);
        return;
      }
      const time = param.time as number;
      const bar = state.candles.find((c) => c.time === time);
      updateLegend({ time, ...data, volume: bar?.volume ?? 0 });
    };
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi, dataLabel]);

  /* ---------------- sync in layout: crosshair and visible time range ---------------- */
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const chart = chartApi;
    const candleSeries = candleSeriesRef.current;
    const el = containerRef.current;
    if (!chart || !candleSeries || !el) return;
    const id = chartStore.getState().id;
    let publishingCrosshair = false;
    let applyingCrosshair = false;
    let lastApplied: TimeRangeSync | null = null;
    let lastSent: TimeRangeSync | null = null;
    const visible = () => el.clientWidth > 0 && el.clientHeight > 0; // a hidden (narrow-screen) chart skips applying

    const onMove = (param: MouseEventParams<Time>) => {
      if (applyingCrosshair || !useStore.getState().sync.crosshair) return;
      if (param.point && param.time != null) {
        if (!param.sourceEvent) return; // a programmatic move (a sync landing here), not the person
        const price = candleSeries.coordinateToPrice(param.point.y);
        if (price == null) return;
        const s = chartStore.getState();
        publishingCrosshair = true;
        publishCrosshair(id, { time: param.time as number, price, providerId: s.providerId, symbol: s.symbol });
      } else if (publishingCrosshair) {
        publishingCrosshair = false;
        publishCrosshair(id, null);
      }
    };
    chart.subscribeCrosshairMove(onMove);

    const onRange = (range: { from: Time; to: Time } | null) => {
      if (!range || !useStore.getState().sync.time) return;
      const r = { from: range.from as number, to: range.to as number };
      if (sameTimeRange(r, lastApplied) || sameTimeRange(r, lastSent)) return;
      if (!drivesTime(id, activeRef.current)) return;
      lastSent = r;
      publishTimeRange(id, r);
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(onRange);

    const onEnter = () => setHovered(id, true);
    const onLeave = () => setHovered(id, false);
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);

    const off = subscribe(id, {
      crosshair(pos) {
        if (!useStore.getState().sync.crosshair || !visible()) return;
        applyingCrosshair = true;
        try {
          const s = chartStore.getState();
          const t = pos ? barTimeAt(s.candles, pos.time) : null;
          if (!pos || t == null) {
            chart.clearCrosshairPosition();
            return;
          }
          const bar = s.candles.find((c) => c.time === t);
          const same = pos.providerId === s.providerId && pos.symbol === s.symbol;
          chart.setCrosshairPosition(same ? pos.price : (bar?.close ?? pos.price), t as UTCTimestamp, candleSeries);
        } finally {
          applyingCrosshair = false;
        }
      },
      timeRange(range) {
        if (!useStore.getState().sync.time || !visible() || sameTimeRange(range, lastApplied)) return;
        lastApplied = range;
        try {
          chart.timeScale().setVisibleRange({ from: range.from as UTCTimestamp, to: range.to as UTCTimestamp });
        } catch {
          /* no data to place the range on yet */
        }
      },
    });
    return () => {
      off();
      setHovered(id, false);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      chart.unsubscribeCrosshairMove(onMove);
      chart.timeScale().unsubscribeVisibleTimeRangeChange(onRange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi]);

  /* Zone change: swap the formatters in place (no rebuild, visible range untouched) and redraw the legend. */
  useEffect(() => {
    const chart = chartApi;
    if (!chart) return;
    chart.applyOptions({
      localization: { timeFormatter: (t: Time) => fmtTime(t as number, { timeZone }) },
      timeScale: { tickMarkFormatter: (t: Time, type: number) => fmtTick(t as number, type, timeZone) },
    });
    const last = chartStore.getState().candles.at(-1);
    if (last) updateLegend(last);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi, timeZone]);

  /* ---------------- trade markers ---------------- */
  useEffect(() => {
    const plugin = markersRef.current;
    if (!plugin) return;
    if (!showTrades || !btResult) {
      plugin.setMarkers([]);
      return;
    }
    const markers: SeriesMarker<Time>[] = [];
    for (const t of btResult.trades) {
      if (replayCutoff != null && t.entryTime > replayCutoff) continue; // not yet happened at the replay point
      markers.push({
        time: t.entryTime as UTCTimestamp,
        position: t.side === 'long' ? 'belowBar' : 'aboveBar',
        color: t.side === 'long' ? UP : DOWN,
        shape: t.side === 'long' ? 'arrowUp' : 'arrowDown',
        text: t.side === 'long' ? 'L' : 'S',
        size: 1,
      });
      if (replayCutoff != null && t.exitTime > replayCutoff) continue;
      markers.push({
        time: t.exitTime as UTCTimestamp,
        position: t.side === 'long' ? 'aboveBar' : 'belowBar',
        color: hexToRgba(theme.muted, 0.9),
        shape: 'circle',
        size: 0.6,
      });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    plugin.setMarkers(markers);
  }, [btResult, showTrades, chartApi, replayCutoff]);

  const priceScale = usePriceScale(chartApi, containerRef, priceScaleMode);
  const provider = getProvider(providerId);

  // Restore the fresh-load view: auto-scale every pane's price scales, default right offset, then show the window for the
  // timeframe (minutes: last day, hours: 5 days, days: a month), or all data for weeks, months or when the bars do not reach back.
  async function resetView() {
    if (!chartApi) return;
    const panes = chartApi.panes();
    for (let i = 0; i < panes.length; i++) {
      for (const id of i === 0 ? ['right', 'volume'] : ['right']) {
        try {
          chartApi.priceScale(id, i).applyOptions({ autoScale: true });
        } catch {
          // this pane has no such price scale
        }
      }
    }
    priceScale.refresh();
    chartApi.timeScale().applyOptions({ rightOffset: RIGHT_OFFSET });
    await showDefaultWindow(chartStore.getState().dataKey);
  }

  const favorites = useStore((s) => s.drawingFavorites);
  const lastTool = useStore((s) => s.drawingLastTool);
  const toggleFavorite = useStore((s) => s.toggleDrawingFavorite);
  const drawingControls: DrawingControls = {
    tool: drawings.tool,
    cursorKind: drawings.cursorKind,
    onPick: drawings.pickEntry,
    favorites,
    onToggleFavorite: toggleFavorite,
    lastTool,
    disabled: !drawings.hasData,
    imagesOff: !drawings.imagesAvailable,
    magnet: drawings.magnet,
    onMagnet: drawings.toggleMagnet,
    magnetStrength: drawings.magnetStrength,
    onMagnetMode: drawings.setMagnetMode,
    locked: drawings.lockAll,
    onLocked: drawings.toggleLockAll,
    stayMode: drawings.stayMode,
    onStayMode: drawings.toggleStayMode,
    hidden: drawings.hidden,
    onHidden: drawings.toggleHidden,
    canDeleteAll: drawings.drawingCount > 0,
    onDeleteAll: drawings.deleteAll,
  };

  const paneLegends = usePaneLegends(chartApi, paneStateRef, paneLegendsRef, legendRowsRef, setSettingsId, [drawn, pineRuns, candles, replayCutoff]);
  const paneLabels = new Map([...paneStateRef.current.panes].map(([id, p]) => [id, [p.name, ...p.params].join(' ')] as const));
  const pineIds = new Set(indicators.filter((i) => i.kind === 'pine').map((i) => i.id));

  return (
    <div className="chart-wrap">
      <DrawingRail {...drawingControls} />
      <div className="chart-main">
      <div className="chart-legend">
        <div className="legend-head" ref={legendRef} />
        <PriceLegendRows rows={legendRows} overlays={paneStateRef.current.overlays} onSettings={setSettingsId} rowsRef={legendRowsRef} />
      </div>
      <div className="pane-legends" ref={paneLegendsRef} />
      <PaneLegendActions hosts={paneLegends.actionHosts} pineIds={pineIds} labels={paneLabels} onSettings={setSettingsId} />
      {settingsId && indicators.some((i) => i.id === settingsId) && <IndicatorSettingsDialog id={settingsId} onClose={() => setSettingsId(null)} />}
      <div className={`chart-container${replayPhase === 'picking' ? ' picking' : ''}`} ref={containerRef} />
      {drawings.editor && (
        <DrawingTextEditor
          key={drawings.editor.key}
          left={drawings.editor.left}
          top={drawings.editor.top}
          initialText={drawings.editor.text}
          style={drawings.editor.style}
          onCommit={drawings.editor.onCommit}
          onCancel={drawings.editor.onCancel}
          width={drawings.editor.width}
          onTab={drawings.editor.onTab}
        />
      )}
      {drawings.toolbar && !drawings.settings && !drawings.editor && (
        <DrawingToolbar model={drawings.toolbar} actions={drawings.actions} onStyle={drawings.setStyleField} />
      )}
      {drawings.picker && isGlyphKind(drawings.picker) && <IconPicker key={drawings.picker} kind={drawings.picker} onPick={drawings.choosePick} onClose={drawings.closePicker} />}
      {drawings.settings && <DrawingSettingsDialog key={drawings.settings.drawing.id} model={drawings.settings} />}
      {active && favorites.length > 0 && <FavoritesBar {...drawingControls} />}
      <ChartRangeBar chartApi={chartApi} />
      <ChartContextMenu containerRef={containerRef} seriesRef={candleSeriesRef} precision={precision} enabled={candles.length > 0} onAddAlert={onAddAlert} drawings={drawings.actions} priceScaleMode={priceScaleMode} onPriceScaleMode={setPriceScaleMode} autoScale={priceScale.auto} onAutoScale={priceScale.setAuto} />
      <PriceScaleButtons control={priceScale} mode={priceScaleMode} onMode={setPriceScaleMode} disabled={candles.length === 0} />
      <div className="chart-toolbar">
        {narrow && <DrawingMenu {...drawingControls} />}
        <button
          className="ghost icon"
          title="Reset view"
          disabled={!chartApi || candles.length === 0}
          onClick={resetView}
        >
          ⤢
        </button>
        <button
          className="ghost icon"
          title="Screenshot (PNG)"
          disabled={!chartApi || candles.length === 0}
          onClick={() => {
            const canvas = chartApi?.takeScreenshot();
            if (canvas) downloadDataUrl(`vost_${sanitizeFileName(dataLabel || 'chart')}.png`, canvas.toDataURL('image/png'));
          }}
        >
          ⛶
        </button>
        <button
          className="ghost icon"
          title="Export candles as CSV"
          disabled={candles.length === 0}
          onClick={() => downloadFile(`vost_${sanitizeFileName(dataLabel || 'candles')}.csv`, candlesToCsv(selectDataCandles(chartStore.getState()), { isoDates: false }))}
        >
          ⬇
        </button>
        <button
          className="ghost icon"
          title={showTrades ? 'Hide backtest trades' : 'Show backtest trades'}
          style={{ color: showTrades ? 'var(--accent-2)' : undefined }}
          onClick={() => setShowTrades(!showTrades)}
        >
          ⇅
        </button>
      </div>

      {(candles.length === 0 || loadState === 'loading') && (
        <div className="chart-empty">
          {loadState === 'loading' ? (
            <div className="row">
              <span className="spinner" />
              <span>Loading data…</span>
            </div>
          ) : (
            <div className="empty-card">
              <h2>No data on the chart yet</h2>
              <p>
                Pull free public data from <b>Binance</b>, <b>Coinbase</b>, <b>Kraken</b>, <b>Bybit</b>, <b>OKX</b>, or <b>Yahoo Finance</b> using the toolbar above — or work{' '}
                <b>completely offline</b> by importing an OHLCV CSV file.
              </p>
              <p className="muted-2">
                {provider.offline ? 'This provider generates deterministic synthetic candles locally.' : provider.description}
              </p>
              <div className="empty-actions">
                <button className="primary" onClick={() => void chartStore.getState().loadData()}>
                  Load {provider.name} data
                </button>
                <button onClick={onImportCsv}>Import CSV</button>
                <button
                  onClick={() => {
                    if (providerId !== 'demo') setProvider('demo');
                    else void chartStore.getState().loadData();
                  }}
                >
                  Try demo data
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
