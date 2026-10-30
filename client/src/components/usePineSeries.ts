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
import { PineFillPrimitive } from './pineFillPrimitive';
import { runFitsVisible } from '../lib/replay';
import type { PineRunState } from '../state/chart';

type PineSeries = ISeriesApi<'Line'> | ISeriesApi<'Histogram'>;

interface BuiltFill {
  itemId: string;
  index: number;
  prim: PineFillPrimitive;
}

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

/** The marker panes a script uses, price first: one invisible carrier series each. */
type MarkerKind = 'price' | 'separate' | 'scale';
const kindOf = (m: PineChartModel['markers'][number]): MarkerKind =>
  m.pane === 'price' ? 'price' : m.onScale ? 'scale' : 'separate';
/** 'scale' carries absolute marks at their value on the pane's own right scale. */
const markerPanes = (it: { model: PineChartModel }): MarkerKind[] =>
  (['price', 'separate', 'scale'] as const).filter((p) => it.model.markers.some((m) => kindOf(m) === p));

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
  /** During replay: a run reaching past this bar time is never drawn. */
  lastVisibleTime: number | null = null,
) {
  const ref = useRef({ sig: '', epoch: -1, built: [] as Built[], fills: [] as BuiltFill[], descs: [] as PineSeriesDesc[] });

  useEffect(() => {
    if (!chart) return;
    const st = ref.current;
    const items: Array<{ id: string; model: PineChartModel; closes: number[]; times: number[] }> = [];
    for (const spec of indicators) {
      const run = pineRuns[spec.id];
      if (spec.kind !== 'pine' || !spec.visible || !run?.result || !run.candles) continue;
      if (!runFitsVisible(run.candles, lastVisibleTime)) continue;
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
        [...new Set(it.model.markers.map(kindOf))].sort(),
        it.model.series.map((s) => [s.key, s.type, s.pane, s.color, s.lineWidth, s.dashed, s.pointsOnly, s.band]),
        it.model.fills.map((f) => [f.key1, f.key2, f.pane, f.color]),
      ]),
    );

    const fill = (it: (typeof items)[number], built: Built[]) => {
      let i = 0;
      for (const d of it.model.series) (built[i++].series as ISeriesApi<'Line'>).setData(toData(d) as never);
      for (const pane of markerPanes(it)) {
        const anchor = built[i++];
        if (pane === 'price') {
          anchor.series.setData(it.times.map((t, k) => ({ time: t as UTCTimestamp, value: it.closes[k] })) as never);
          anchor.plugin?.setMarkers(
            it.model.markers
              .filter((m) => m.pane === 'price')
              .map(({ pane: _p, panePosition: _pp, price: _pr, ...m }) => ({ ...m, time: m.time as UTCTimestamp })),
          );
        } else {
          const mk = it.model.markers.filter((m) => kindOf(m) === pane);
          if (pane === 'scale') {
            const at = new Map(mk.map((m) => [m.time, m.price]));
            anchor.series.setData(
              it.times.map((t) => (at.has(t) ? { time: t as UTCTimestamp, value: at.get(t)! } : { time: t as UTCTimestamp })) as never,
            );
          } else {
            anchor.series.setData(it.times.map((t) => ({ time: t as UTCTimestamp, value: 0.5 })) as never);
          }
          anchor.plugin?.setMarkers(
            mk
              .map((m) => ({
                time: m.time as UTCTimestamp,
                position: m.panePosition,
                price: m.price,
                shape: m.shape,
                color: m.color,
                size: m.size,
                ...(m.text && { text: m.text }),
              })),
          );
        }
      }
    };

    const fillData = (it: (typeof items)[number], index: number) => {
      const f = it.model.fills[index];
      const values = (key: string) => it.model.series.find((d) => d.key === key)!.data.map((p) => p.value ?? null);
      return { times: it.times, v1: values(f.key1), v2: values(f.key2), color: f.color, colors: f.colors };
    };

    if (sig === st.sig && st.epoch === epochRef.current) {
      for (const bf of st.fills) {
        const it = items.find((x) => x.id === bf.itemId);
        if (it) bf.prim.setData(fillData(it, bf.index));
      }
      let offset = 0;
      for (const it of items) {
        const n = it.model.series.length + markerPanes(it).length;
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
    st.fills = []; // detached with their series
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
      for (const pane of markerPanes(it)) {
        // Invisible carrier: markers attach to a series.
        const separate = pane === 'separate';
        if (pane !== 'price' && sepPane < 0) {
          chart.addPane();
          sepPane = chart.panes().length - 1;
        }
        const paneIndex = pane === 'price' ? 0 : sepPane;
        const scaleId = separate ? `pine_mark_${it.id}` : 'right';
        const series = chart.addSeries(
          LineSeries,
          {
            lineVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            priceScaleId: scaleId,
            ...(separate && { autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }) }),
          },
          paneIndex,
        );
        if (separate) {
          chart.priceScale(scaleId, paneIndex).applyOptions({ visible: false, scaleMargins: { top: 0.12, bottom: 0.12 } });
        }
        mine.push({ series, plugin: createSeriesMarkers(series, []) });
      }
      fill(it, mine);
      it.model.fills.forEach((f, index) => {
        const at = (key: string) => mine[it.model.series.findIndex((d) => d.key === key)]?.series;
        const first = at(f.key1);
        const second = at(f.key2);
        if (!first || !second) return;
        const prim = new PineFillPrimitive(second);
        first.attachPrimitive(prim);
        prim.setData(fillData(it, index));
        st.fills.push({ itemId: it.id, index, prim });
      });
      st.built.push(...mine);
    }
    st.sig = sig;
    st.epoch = epochRef.current;
  }, [chart, indicators, pineRuns, epochRef, lastVisibleTime]);
}
