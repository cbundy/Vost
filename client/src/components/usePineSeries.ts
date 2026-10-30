import {
  BarSeries,
  BaselineSeries,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineWidth,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, type MutableRefObject } from 'react';
import type { IndicatorSpec } from '../lib/indicatorCompute';
import { pineIndicatorName } from '../lib/pine/title';
import { newPaneState, releasePanes, sizePanes, type PaneReg, type PaneState } from './usePaneLegends';
import { buildPineChart, fadedColor, type PineChartModel, type PineSeriesDesc } from '../lib/pine/chartSeries';
import { PineFillPrimitive } from './pineFillPrimitive';
import { PineCharPrimitive } from './pineCharPrimitive';
import { attachPineDrawings, type PineDrawingsPrimitive } from './pineDrawingsPrimitive';
import { drawingPriceRange, drawingsOfPane } from '../lib/pine/drawingObjects';
import { useChartStore } from '../state/chartContext';
import { runFitsVisible } from '../lib/replay';
import type { PineDrawings } from '../lib/pine/types';
import type { PineRunState } from '../state/chart';

type PineSeries = ISeriesApi<'Line'> | ISeriesApi<'Baseline'> | ISeriesApi<'Histogram'> | ISeriesApi<'Candlestick'> | ISeriesApi<'Bar'>;
type ValueSeries = ISeriesApi<'Line'> | ISeriesApi<'Baseline'> | ISeriesApi<'Histogram'>;

interface BuiltFill {
  itemId: string;
  index: number;
  prim: PineFillPrimitive;
}

interface BuiltDrawings {
  itemId: string;
  pane: 'price' | 'separate';
  prim: PineDrawingsPrimitive;
}

interface Built {
  series: PineSeries;
  plugin?: ISeriesMarkersPluginApi<Time>;
  chars?: PineCharPrimitive;
}

const toData = (d: PineSeriesDesc) =>
  d.data.map((p) =>
    p.value === undefined || ((d.type === 'candle' || d.type === 'bar') && !p.ohlc)
      ? { time: p.time as UTCTimestamp }
      : p.ohlc
        ? {
            time: p.time as UTCTimestamp,
            open: p.ohlc[0], high: p.ohlc[1], low: p.ohlc[2], close: p.ohlc[3],
            ...(p.color && { color: p.color }),
            ...(p.wickColor && { wickColor: p.wickColor }),
            ...(p.borderColor && { borderColor: p.borderColor }),
          }
        : d.type === 'histogram'
        ? { time: p.time as UTCTimestamp, value: p.value, color: p.color ?? d.color }
        : { time: p.time as UTCTimestamp, value: p.value, ...(p.color && { color: p.color }) },
  );

/** The marker panes a script uses, price first: one invisible carrier series each. */
type MarkerKind = 'price' | 'separate' | 'scale';
const kindOf = (m: { pane: 'price' | 'separate'; onScale?: boolean }): MarkerKind =>
  m.pane === 'price' ? 'price' : m.onScale ? 'scale' : 'separate';
/** 'scale' carries absolute marks at their value on the pane's own right scale. Plotchar glyphs ride the same carriers. */
const markerPanes = (it: { model: PineChartModel }): MarkerKind[] =>
  (['price', 'separate', 'scale'] as const).filter((p) => it.model.markers.some((m) => kindOf(m) === p) || it.model.chars.some((c) => kindOf(c) === p));

/**
 * The panes whose drawing objects need an invisible carrier series of their own: the price pane always, a
 * script's own pane only when it has no series there to carry them.
 */
const drawingCarriers = (it: { model: PineChartModel; drawings: Record<'price' | 'separate', unknown> }): Array<'price' | 'separate'> => [
  ...(it.drawings.price ? (['price'] as const) : []),
  ...(it.drawings.separate && !it.model.series.some((d) => d.pane === 'separate') ? (['separate'] as const) : []),
];

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
  /** The panes built and the sizes kept, shared with the built-in pane builder and the pane legends. */
  paneStateRef?: MutableRefObject<PaneState>,
) {
  const ownState = useRef<PaneState>(newPaneState());
  const paneState = paneStateRef ?? ownState;
  const chartStore = useChartStore();
  const ref = useRef({ sig: '', epoch: -1, built: [] as Built[], fills: [] as BuiltFill[], objects: [] as BuiltDrawings[], descs: [] as PineSeriesDesc[] });

  // The pointer goes to every drawings primitive, which shows a label's or table cell's tooltip when it is over one.
  useEffect(() => {
    if (!chart) return;
    const onMove = (p: MouseEventParams<Time>) => {
      for (const o of ref.current.objects) o.prim.crosshairMoved(p.paneIndex, p.point);
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      for (const o of ref.current.objects) o.prim.setHover(null);
    };
  }, [chart]);

  useEffect(() => {
    if (!chart) return;
    const st = ref.current;
    const items: Array<{
      id: string;
      model: PineChartModel;
      closes: number[];
      times: number[];
      name: string;
      params: string[];
      drawings: Record<'price' | 'separate', PineDrawings | null>;
    }> = [];
    // The chart's own bar times, so objects stay on their bars when older history loads.
    let cachedFor: unknown = null;
    let cachedTimes: number[] = [];
    const chartTimes = () => {
      const candles = chartStore.getState().candles;
      if (candles !== cachedFor) {
        cachedFor = candles;
        cachedTimes = candles.map((c) => c.time);
      }
      return cachedTimes;
    };
    for (const spec of indicators) {
      const run = pineRuns[spec.id];
      if (spec.kind !== 'pine' || !spec.visible || !run?.result || !run.candles) continue;
      if (!runFitsVisible(run.candles, lastVisibleTime)) continue;
      items.push({
        id: spec.id,
        model: buildPineChart(run.result, run.candles, spec.color),
        drawings: { price: drawingsOfPane(run.result.drawings, 'price'), separate: drawingsOfPane(run.result.drawings, 'separate') },
        closes: run.candles.map((c) => c.close),
        times: run.candles.map((c) => c.time),
        name: pineIndicatorName(spec.source ?? '', run.result.declaration.title),
        params: run.result.inputs.flatMap((inp) => {
          const v = spec.inputs?.[inp.name] ?? inp.defval;
          return v == null ? [] : [String(v)];
        }),
      });
    }
    const sig = JSON.stringify(
      items.map((it) => [
        it.id,
        [...new Set([...it.model.markers, ...it.model.chars].map(kindOf))].sort(),
        it.model.series.map((s) => [s.key, s.type, s.pane, s.color, s.lineWidth, s.lineStyle, s.lineType, s.base, s.pointsOnly, s.band]),
        it.model.fills.map((f) => [f.key1, f.key2, f.pane, f.color]),
        [it.drawings.price !== null, it.drawings.separate !== null],
      ]),
    );

    const fill = (it: (typeof items)[number], built: Built[]) => {
      let i = 0;
      for (const d of it.model.series) (built[i++].series as ISeriesApi<'Line'>).setData(toData(d) as never);
      for (const pane of markerPanes(it)) {
        const anchor = built[i++];
        anchor.chars?.setData(it.model.chars.filter((c) => kindOf(c) === pane));
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
            const at = new Map([...mk, ...it.model.chars.filter((c) => kindOf(c) === pane)].map((m) => [m.time, m.price]));
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

    const fillCarriers = (it: (typeof items)[number], built: Built[], from: number) => {
      let i = from;
      for (const pane of drawingCarriers(it)) {
        const carrier = built[i++].series;
        // A series with no value cannot place a price, so the pane's own carrier holds the middle of the objects' range.
        const range = pane === 'separate' && it.drawings.separate ? drawingPriceRange(it.drawings.separate) : null;
        const mid = range ? (range.min + range.max) / 2 : 0;
        carrier.setData(it.times.map((t, k) => ({ time: t as UTCTimestamp, value: pane === 'price' ? it.closes[k] : mid })) as never);
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
      for (const bd of st.objects) bd.prim.setData(items.find((x) => x.id === bd.itemId)?.drawings[bd.pane] ?? null);
      for (const it of items) {
        const reg = paneState.current.panes.get(it.id);
        if (reg) {
          reg.name = it.name;
          reg.params = it.params;
        }
      }
      let offset = 0;
      for (const it of items) {
        const n = it.model.series.length + markerPanes(it).length + drawingCarriers(it).length;
        const mine = st.built.slice(offset, offset + n);
        fill(it, mine);
        fillCarriers(it, mine, it.model.series.length + markerPanes(it).length);
        offset += n;
      }
      return;
    }

    // Before removing series empties and drops the panes: keep the sizes the user left them at.
    releasePanes(chart, paneState.current, 'pine', new Set(indicators.map((s) => s.id)));
    for (const { series } of st.built) {
      try {
        chart.removeSeries(series);
      } catch {
        /* already gone with its pane */
      }
    }
    st.built = [];
    st.fills = []; // detached with their series
    st.objects = [];
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
        if (d.type === 'candle' || d.type === 'bar') {
          const common = { priceLineVisible: false, lastValueVisible: false, priceScaleId: 'right' };
          series = d.type === 'candle'
            ? chart.addSeries(CandlestickSeries, { ...common, upColor: d.color, downColor: d.color, borderVisible: true, wickVisible: true }, paneIndex)
            : chart.addSeries(BarSeries, { ...common, upColor: d.color, downColor: d.color }, paneIndex);
        } else if (d.type === 'histogram') {
          const scaleId = d.band ? `pine_band_${it.id}` : d.pane === 'price' ? `pine_hist_${it.id}` : 'right';
          series = chart.addSeries(
            HistogramSeries,
            {
              color: d.color,
              base: d.base ?? 0,
              priceLineVisible: false,
              lastValueVisible: !d.band && d.pane === 'separate',
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
        } else if (d.type === 'area') {
          const fade = fadedColor(d.color, 0.25);
          series = chart.addSeries(
            BaselineSeries,
            {
              baseValue: { type: 'price', price: d.base ?? 0 },
              lineWidth: d.lineWidth as LineWidth,
              topLineColor: d.color,
              topFillColor1: fade,
              topFillColor2: fade,
              bottomLineColor: d.color,
              bottomFillColor1: fade,
              bottomFillColor2: fade,
              priceLineVisible: false,
              lastValueVisible: d.pane === 'separate',
              crosshairMarkerVisible: false,
              priceScaleId: 'right',
            },
            paneIndex,
          );
        } else {
          series = chart.addSeries(
            LineSeries,
            {
              color: d.color,
              lineWidth: d.lineWidth as LineWidth,
              lineStyle: d.lineStyle === 'dotted' ? LineStyle.Dotted : d.lineStyle === 'dashed' ? LineStyle.Dashed : LineStyle.Solid,
              lineType: d.lineType === 'steps' ? LineType.WithSteps : LineType.Simple,
              priceLineVisible: false,
              lastValueVisible: d.pane === 'separate' || !d.hline,
              crosshairMarkerVisible: false,
              lineVisible: !d.pointsOnly,
              pointMarkersVisible: Boolean(d.pointsOnly),
              ...(d.pointsOnly && { pointMarkersRadius: d.lineWidth + 1 }),
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
        const chars = new PineCharPrimitive();
        series.attachPrimitive(chars);
        mine.push({ series, plugin: createSeriesMarkers(series, []), chars });
      }
      fill(it, mine);
      const carried = drawingCarriers(it);
      for (const pane of carried) {
        if (pane === 'separate' && sepPane < 0) {
          chart.addPane();
          sepPane = chart.panes().length - 1;
        }
        const series = chart.addSeries(
          LineSeries,
          {
            lineVisible: false,
            priceLineVisible: false,
            lastValueVisible: false,
            crosshairMarkerVisible: false,
            priceScaleId: 'right',
          },
          pane === 'price' ? 0 : sepPane,
        );
        mine.push({ series });
      }
      fillCarriers(it, mine, it.model.series.length + markerPanes(it).length);
      for (const pane of ['price', 'separate'] as const) {
        const data = it.drawings[pane];
        if (!data) continue;
        // A script's own pane without a series of its own is scaled by its objects; otherwise they ride its first series.
        const hostIdx = pane === 'separate' ? it.model.series.findIndex((d) => d.pane === 'separate') : -1;
        const carrierIdx = it.model.series.length + markerPanes(it).length + carried.indexOf(pane);
        const host = hostIdx >= 0 ? mine[hostIdx].series : mine[carrierIdx].series;
        const prim = attachPineDrawings(host, chartTimes, hostIdx < 0 && pane === 'separate');
        prim.setData(data);
        st.objects.push({ itemId: it.id, pane, prim });
      }
      if (sepPane >= 0) {
        sizePanes(chart, paneState.current, [{ id: it.id, paneIndex: sepPane }]);
        const entries: PaneReg['entries'] = [];
        it.model.series.forEach((d, k) => {
          if (d.pane === 'separate' && !d.hline && !d.band && d.type !== 'candle' && d.type !== 'bar') {
            entries.push({ title: d.title, color: d.color, series: mine[k].series as ValueSeries });
          }
        });
        paneState.current.panes.set(it.id, { id: it.id, source: 'pine', paneIndex: sepPane, name: it.name, params: it.params, entries });
      }
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
  }, [chart, chartStore, indicators, pineRuns, epochRef, lastVisibleTime, paneState]);
}
