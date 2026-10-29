import { DOWN_COLOR, UP_COLOR, chartTheme, theme } from '../lib/theme';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
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
import { computeIndicator, hexToRgba, type ComputedSeries } from '../lib/indicatorCompute';
import { getProvider } from '../lib/providers';
import { useStore } from '../state/store';
import { selectDataCandles } from '../state/chart';
import { usePineSeries } from './usePineSeries';
import { useDrawings } from './chart/useDrawings';
import { DrawingTextEditor } from './DrawingTextEditor';
import { DrawingMenu, DrawingRail, type DrawingControls } from './DrawingRail';
import { useMediaQuery } from '../lib/useMediaQuery';
import { useChart, useChartStore } from '../state/chartContext';

type IndEntry = {
  series: ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;
  kind: ComputedSeries['kind'];
};

const RIGHT_OFFSET = 3;
const UP = UP_COLOR;
const DOWN = DOWN_COLOR;

function toCandleData(c: { time: number; open: number; high: number; low: number; close: number }) {
  return {
    time: c.time as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

function mapIndicatorPoint(cs: ComputedSeries, point: { time: number; value: number; color?: string }) {
  const time = point.time as UTCTimestamp;
  if (cs.kind === 'histogram') return { time, value: point.value, color: point.color ?? cs.color };
  return { time, value: point.value };
}

export function ChartPanel({ onImportCsv, onAddAlert }: { onImportCsv: () => void; onAddAlert: (level: number) => void }) {
  const chartStore = useChartStore();
  const candles = useChart((s) => s.candles);
  const dataKey = useChart((s) => s.dataKey);
  const dataLabel = useChart((s) => s.dataLabel);
  const indicators = useChart((s) => s.indicators);
  const btResult = useChart((s) => s.btResult);
  const showTrades = useChart((s) => s.showTrades);
  const setShowTrades = useChart((s) => s.setShowTrades);
  const loadState = useChart((s) => s.loadState);
  const pineRuns = useChart((s) => s.pineRuns);
  const providerId = useChart((s) => s.providerId);
  const setProvider = useChart((s) => s.setProvider);
  const timeZone = useStore((s) => s.timeZone);
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
  const lastIndicatorsRef = useRef<unknown>(null);
  const lastCandlesRef = useRef<typeof candles | null>(null);
  const savedRangeRef = useRef<{ from: number; to: number } | null>(null);
  const [chartApi, setChartApi] = useState<IChartApi | null>(null);
  const paneEpochRef = useRef(0);

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

    const visible = indicators.filter((i) => i.visible);
    const subCount = visible.filter((s) => s.kind === 'rsi' || s.kind === 'macd').length;
    for (let i = 0; i < subCount; i++) chart.addPane();

    let subIdx = 0;
    for (const spec of visible) {
      const computed = computeIndicator(spec, chartStore.getState().candles);
      if (computed.length === 0) continue;
      let paneIndex = 0;
      if (computed[0].pane === 'sub') {
        paneIndex = 1 + subIdx;
        subIdx++;
      }
      for (const cs of computed) {
        const common = {
          priceLineVisible: false,
          lastValueVisible: cs.pane !== 'volume',
          crosshairMarkerVisible: false,
          lineWidth: (cs.lineWidth ?? 2) as LineWidth,
          lineStyle: cs.dashed ? LineStyle.Dashed : LineStyle.Solid,
        };
        if (cs.kind === 'histogram') {
          const series = chart.addSeries(
            HistogramSeries,
            {
              color: cs.color,
              priceFormat: { type: cs.pane === 'volume' ? 'volume' : 'price' },
              priceScaleId: cs.pane === 'volume' ? 'volume' : 'right',
              lastValueVisible: cs.pane !== 'volume',
              priceLineVisible: false,
            },
            paneIndex,
          );
          if (cs.pane === 'volume') {
            chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
          }
          indMapRef.current.set(`${spec.id}|${cs.key}`, { series, kind: 'histogram' });
        } else {
          const series = chart.addSeries(
            LineSeries,
            { color: cs.color, ...common, priceScaleId: 'right' },
            paneIndex,
          );
          for (const pl of cs.priceLines ?? []) {
            series.createPriceLine({
              price: pl.value,
              color: pl.color,
              lineWidth: 1,
              lineStyle: LineStyle.Dashed,
              axisLabelVisible: false,
              title: '',
            });
          }
          indMapRef.current.set(`${spec.id}|${cs.key}`, { series, kind: 'line' });
        }
      }
    }
  }, [chartApi, indicators]);

  usePineSeries(chartApi, indicators, pineRuns, paneEpochRef, replayCutoff);
  const narrow = useMediaQuery('(max-width: 600px)');
  const drawings = useDrawings(chartApi, chartApi ? candleSeriesRef.current : null, containerRef);

  /* Entering replay: remember the view before the data effect cuts the bars. Exit restores it (below). */
  useEffect(() => {
    if (replayPhase !== 'active' || !chartApi) return;
    const r = chartApi.timeScale().getVisibleLogicalRange();
    savedRangeRef.current = r ? { from: r.from, to: r.to } : null;
  }, [chartApi, replayPhase === 'active']);

  /* ---------------- push data (full or incremental) ---------------- */
  useEffect(() => {
    const chart = chartApi;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries || candles.length === 0) return;

    const dataChanged = lastDataKeyRef.current !== dataKey;
    const indChanged = lastIndicatorsRef.current !== indicators;

    // One bar appended or the last bar changed: send just that bar. Any other change to the same data
    // (replay entering, stepping back, exiting, a merged backfill) replaces the bars without refitting.
    const prev = lastCandlesRef.current;
    const incremental =
      !dataChanged &&
      prev != null &&
      prev.length > 0 &&
      candles.length - prev.length >= 0 &&
      candles.length - prev.length <= 1 &&
      candles[prev.length - 1].time === prev[prev.length - 1].time;
    lastCandlesRef.current = candles;

    if (dataChanged) {
      candleSeries.setData(candles.map(toCandleData));
      lastDataKeyRef.current = dataKey;
      chart.timeScale().fitContent();
    } else if (incremental) {
      candleSeries.update(toCandleData(candles[candles.length - 1]));
    } else {
      candleSeries.setData(candles.map(toCandleData));
    }

    if (dataChanged || indChanged || !incremental) {
      for (const spec of indicators) {
        if (!spec.visible) continue;
        for (const cs of computeIndicator(spec, candles)) {
          const entry = indMapRef.current.get(`${spec.id}|${cs.key}`);
          if (!entry) continue;
          const data = cs.data.map((p) => mapIndicatorPoint(cs, p));
          if (entry.kind === 'histogram') (entry.series as ISeriesApi<'Histogram'>).setData(data as never);
          else (entry.series as ISeriesApi<'Line'>).setData(data as never);
        }
      }
      lastIndicatorsRef.current = indicators;
    } else {
      for (const spec of indicators) {
        if (!spec.visible) continue;
        for (const cs of computeIndicator(spec, candles)) {
          const entry = indMapRef.current.get(`${spec.id}|${cs.key}`);
          if (!entry || cs.data.length === 0) continue;
          const point = mapIndicatorPoint(cs, cs.data[cs.data.length - 1]);
          if (entry.kind === 'histogram') (entry.series as ISeriesApi<'Histogram'>).update(point as never);
          else (entry.series as ISeriesApi<'Line'>).update(point as never);
        }
      }
    }

    updateLegend(candles[candles.length - 1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartApi, candles, dataKey, indicators]);

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

  const provider = getProvider(providerId);

  // Restore the fresh-load view: auto-scale every pane's price scales, default right offset, fit all data.
  function resetView() {
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
    chartApi.timeScale().applyOptions({ rightOffset: RIGHT_OFFSET });
    chartApi.timeScale().fitContent();
  }

  const drawingControls: DrawingControls = {
    tool: drawings.tool,
    onPick: drawings.pickTool,
    disabled: !drawings.hasData,
    magnet: drawings.magnet,
    onMagnet: drawings.toggleMagnet,
    hidden: drawings.hidden,
    onHidden: drawings.toggleHidden,
    canDeleteAll: drawings.drawingCount > 0,
    onDeleteAll: drawings.deleteAll,
  };

  return (
    <div className="chart-wrap">
      <DrawingRail {...drawingControls} />
      <div className="chart-main">
      <div className="chart-legend" ref={legendRef} />
      <div className={`chart-container${replayPhase === 'picking' ? ' picking' : ''}`} ref={containerRef} />
      {drawings.editor && (
        <DrawingTextEditor
          key={drawings.editor.key}
          left={drawings.editor.left}
          top={drawings.editor.top}
          initialText={drawings.editor.text}
          onCommit={drawings.editor.onCommit}
          onCancel={drawings.editor.onCancel}
        />
      )}
      <ChartRangeBar chartApi={chartApi} />
      <ChartContextMenu containerRef={containerRef} seriesRef={candleSeriesRef} precision={precision} enabled={candles.length > 0} onAddAlert={onAddAlert} />
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
