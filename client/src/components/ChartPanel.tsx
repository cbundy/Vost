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
import { fmtCompact, fmtPct, fmtPrice, fmtTime } from '../lib/format';
import { computeIndicator, hexToRgba, type ComputedSeries } from '../lib/indicatorCompute';
import { getProvider } from '../lib/providers';
import { useStore } from '../state/store';
import { usePineSeries } from './usePineSeries';

type IndEntry = {
  series: ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;
  kind: ComputedSeries['kind'];
};

const UP = '#22c55e';
const DOWN = '#ef4444';

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

export function ChartPanel({ onImportCsv }: { onImportCsv: () => void }) {
  const candles = useStore((s) => s.candles);
  const dataKey = useStore((s) => s.dataKey);
  const dataLabel = useStore((s) => s.dataLabel);
  const indicators = useStore((s) => s.indicators);
  const btResult = useStore((s) => s.btResult);
  const showTrades = useStore((s) => s.showTrades);
  const setShowTrades = useStore((s) => s.setShowTrades);
  const loadState = useStore((s) => s.loadState);
  const pineRuns = useStore((s) => s.pineRuns);
  const providerId = useStore((s) => s.providerId);
  const setProvider = useStore((s) => s.setProvider);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const legendRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const indMapRef = useRef(new Map<string, IndEntry>());
  const lastDataKeyRef = useRef('');
  const lastIndicatorsRef = useRef<unknown>(null);
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
        background: { type: ColorType.Solid, color: '#0b0e14' },
        textColor: '#8b94a7',
        fontSize: 11,
        fontFamily: "Inter, 'Segoe UI', system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: 'rgba(255,255,255,0.035)' },
        horzLines: { color: 'rgba(255,255,255,0.035)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: 'rgba(139,148,167,0.45)', labelBackgroundColor: '#2a3348' },
        horzLine: { color: 'rgba(139,148,167,0.45)', labelBackgroundColor: '#2a3348' },
      },
      rightPriceScale: { borderColor: '#1e2433' },
      timeScale: {
        borderColor: '#1e2433',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
      },
      localization: { locale: 'en-US' },
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
      const computed = computeIndicator(spec, useStore.getState().candles);
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

  usePineSeries(chartApi, indicators, pineRuns, paneEpochRef);

  /* ---------------- push data (full or incremental) ---------------- */
  useEffect(() => {
    const chart = chartApi;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries || candles.length === 0) return;

    const dataChanged = lastDataKeyRef.current !== dataKey;
    const indChanged = lastIndicatorsRef.current !== indicators;

    if (dataChanged) {
      candleSeries.setData(candles.map(toCandleData));
      lastDataKeyRef.current = dataKey;
      chart.timeScale().fitContent();
    } else {
      candleSeries.update(toCandleData(candles[candles.length - 1]));
    }

    if (dataChanged || indChanged) {
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

  /* ---------------- legend (imperative, rAF-throttled) ---------------- */
  const legendRaf = useRef(0);
  function updateLegend(c: { time: number; open: number; high: number; low: number; close: number; volume: number } | null) {
    const el = legendRef.current;
    if (!el || !c) return;
    cancelAnimationFrame(legendRaf.current);
    legendRaf.current = requestAnimationFrame(() => {
      const chg = c.open !== 0 ? ((c.close - c.open) / c.open) * 100 : 0;
      const cls = chg >= 0 ? 'pos' : 'neg';
      el.innerHTML =
        `<div class="legend-title">${escapeHtml(dataLabel)}</div>` +
        `<div class="legend-ohlc">` +
        `O <b>${fmtPrice(c.open)}</b> H <b>${fmtPrice(c.high)}</b> L <b>${fmtPrice(c.low)}</b> C <b>${fmtPrice(c.close)}</b> ` +
        `<span class="${cls}">${fmtPct(chg)}</span> V <b>${fmtCompact(c.volume)}</b> ` +
        `<span class="muted-2">${fmtTime(c.time)}</span>` +
        `</div>`;
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
      const state = useStore.getState();
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
      markers.push({
        time: t.entryTime as UTCTimestamp,
        position: t.side === 'long' ? 'belowBar' : 'aboveBar',
        color: t.side === 'long' ? UP : DOWN,
        shape: t.side === 'long' ? 'arrowUp' : 'arrowDown',
        text: t.side === 'long' ? 'L' : 'S',
        size: 1,
      });
      markers.push({
        time: t.exitTime as UTCTimestamp,
        position: t.side === 'long' ? 'aboveBar' : 'belowBar',
        color: hexToRgba('#8b94a7', 0.9),
        shape: 'circle',
        size: 0.6,
      });
    }
    markers.sort((a, b) => (a.time as number) - (b.time as number));
    plugin.setMarkers(markers);
  }, [btResult, showTrades, chartApi]);

  const provider = getProvider(providerId);

  return (
    <div className="chart-wrap">
      <div className="chart-legend" ref={legendRef} />
      <div className="chart-container" ref={containerRef} />
      <div className="chart-toolbar">
        <button className="ghost icon" title="Fit all data" onClick={() => chartApi?.timeScale().fitContent()}>
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
          onClick={() => downloadFile(`vost_${sanitizeFileName(dataLabel || 'candles')}.csv`, candlesToCsv(candles, { isoDates: false }))}
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
                Pull free public data from <b>Binance</b>, <b>Coinbase</b>, <b>Kraken</b>, <b>Bybit</b>, <b>OKX</b>, <b>Yahoo Finance</b> or <b>Stooq</b> using the toolbar above — or work{' '}
                <b>completely offline</b> by importing an OHLCV CSV file.
              </p>
              <p className="muted-2">
                {provider.offline ? 'This provider generates deterministic synthetic candles locally.' : provider.description}
              </p>
              <div className="empty-actions">
                <button className="primary" onClick={() => void useStore.getState().loadData()}>
                  Load {provider.name} data
                </button>
                <button onClick={onImportCsv}>Import CSV</button>
                <button
                  onClick={() => {
                    if (providerId !== 'demo') setProvider('demo');
                    else void useStore.getState().loadData();
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
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string);
}
