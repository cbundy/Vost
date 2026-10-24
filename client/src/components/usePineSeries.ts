import {
  HistogramSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineWidth,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { IndicatorSpec } from '../lib/indicatorCompute';
import { buildPineChart, type PineChartModel, type PineSeriesDesc } from '../lib/pine/chartSeries';
import type { PineRunState } from '../state/store';

type PineSeries = ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;

interface Built {
  series: PineSeries;
  plugin?: ISeriesMarkersPluginApi<Time>;
}

const toData = (d: PineSeriesDesc) =>
  d.data.map((p) =>
    p.value === undefined
      ? { time: p.time as UTCTimestamp }
      : d.type === 'histogram'
        ? { time: p.time as UTCTimestamp, value: p.value, color: p.color ?? d.color }
        : { time: p.time as UTCTimestamp, value: p.value, ...(p.color && { color: p.color }) },
  );

/**
 * Draws the Pine results of visible pine indicators onto the chart: price-pane
 * series on the main pane, the rest in one extra pane per script, after the
 * built-in RSI/MACD panes. `epochRef` is bumped by the built-in rebuild, which
 * drops panes and so invalidates what is built here.
 */
export function usePineSeries(
  chart: IChartApi | null,
  indicators: IndicatorSpec[],
  pineRuns: Record<string, PineRunState>,
  epochRef: MutableRefObject<number>,
) {
  const ref = useRef({ sig: '', epoch: -1, built: [] as Built[], descs: [] as PineSeriesDesc[] });

  useEffect(() => {
    if (!chart) return;
    const st = ref.current;
    const items: Array<{ id: string; model: PineChartModel; closes: number[]; times: number[] }> = [];
    for (const spec of indicators) {
      const run = pineRuns[spec.id];
      if (spec.kind !== 'pine' || !spec.visible || !run?.result || !run.candles) continue;
      items.push({
        id: spec.id,
        model: buildPineChart(run.result, run.candles, spec.color),
        closes: run.candles.map((c) => c.close),
        times: run.candles.map((c) => c.time),
      });
    }
    const sig = JSON.stringify(
      items.map((it) => [
        it.id,
        it.model.markers.length > 0,
        it.model.series.map((s) => [s.key, s.type, s.pane, s.color, s.lineWidth, s.dashed, s.pointsOnly, s.band]),
      ]),
    );

    const fill = (it: (typeof items)[number], built: Built[]) => {
      let i = 0;
      for (const d of it.model.series) (built[i++].series as ISeriesApi<'Line'>).setData(toData(d) as never);
      if (it.model.markers.length > 0) {
        const anchor = built[i];
        anchor.series.setData(it.times.map((t, k) => ({ time: t as UTCTimestamp, value: it.closes[k] })) as never);
        anchor.plugin?.setMarkers(
          it.model.markers.map((m) => ({ ...m, time: m.time as UTCTimestamp })),
        );
      }
    };

    if (sig === st.sig && st.epoch === epochRef.current) {
      let offset = 0;
      for (const it of items) {
        const n = it.model.series.length + (it.model.markers.length > 0 ? 1 : 0);
        fill(it, st.built.slice(offset, offset + n));
        offset += n;
      }
      return;
    }

    for (const { series } of st.built) {
      try {
        chart.removeSeries(series);
      } catch {
        /* already gone with its pane */
      }
    }
    st.built = [];
    const base = 1 + indicators.filter((s) => s.visible && (s.kind === 'rsi' || s.kind === 'macd')).length;
    for (let i = chart.panes().length - 1; i >= base; i--) {
      try {
        chart.removePane(i);
      } catch {
        /* pane busy */
      }
    }

    for (const it of items) {
      const mine: Built[] = [];
      let sepPane = -1;
      for (const d of it.model.series) {
        let paneIndex = 0;
        if (d.pane === 'separate') {
          if (sepPane < 0) {
            chart.addPane();
            sepPane = chart.panes().length - 1;
          }
          paneIndex = sepPane;
        }
        let series: PineSeries;
        if (d.type === 'histogram') {
          const scaleId = d.band ? `pine_band_${it.id}` : d.pane === 'price' ? `pine_hist_${it.id}` : 'right';
          series = chart.addSeries(
            HistogramSeries,
            {
              color: d.color,
              priceLineVisible: false,
              lastValueVisible: false,
              priceScaleId: scaleId,
              ...(d.band && { autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }) }),
            },
            paneIndex,
          );
          if (scaleId !== 'right') {
            chart.priceScale(scaleId, paneIndex).applyOptions({
              visible: false,
              scaleMargins: d.band ? { top: 0, bottom: 0 } : { top: 0.75, bottom: 0 },
            });
          }
        } else {
          series = chart.addSeries(
            LineSeries,
            {
              color: d.color,
              lineWidth: d.lineWidth as LineWidth,
              lineStyle: d.dashed ? LineStyle.Dashed : LineStyle.Solid,
              priceLineVisible: false,
              lastValueVisible: !d.dashed,
              crosshairMarkerVisible: false,
              lineVisible: !d.pointsOnly,
              pointMarkersVisible: Boolean(d.pointsOnly),
              priceScaleId: 'right',
            },
            paneIndex,
          );
        }
        mine.push({ series });
      }
      if (it.model.markers.length > 0) {
        // Invisible carrier on the price pane: markers attach to a series.
        const series = chart.addSeries(
          LineSeries,
          {
            lineVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            priceScaleId: 'right',
          },
          0,
        );
        mine.push({ series, plugin: createSeriesMarkers(series, []) });
      }
      fill(it, mine);
      st.built.push(...mine);
    }
    st.sig = sig;
    st.epoch = epochRef.current;
  }, [chart, indicators, pineRuns, epochRef]);
}
