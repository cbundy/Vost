import { DOWN_COLOR, UP_COLOR, chartTheme } from '../lib/theme';
import {
  AreaSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type Time,
  type UTCTimestamp,
  type IChartApi,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import { fmtMoney, fmtTime } from '../lib/format';
import { fmtTick } from '../lib/time';
import { useStore } from '../state/store';
import type { BacktestResult } from '../lib/backtest/types';

export function EquityChart({ result }: { result: BacktestResult }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const timeZone = useStore((s) => s.timeZone);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const positive = result.metrics.totalReturnPct >= 0;
    const mainColor = positive ? UP_COLOR : DOWN_COLOR;

    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: chartTheme.text,
        fontSize: 10,
      },
      grid: {
        vertLines: { color: chartTheme.gridFaint },
        horzLines: { color: chartTheme.gridFaint },
      },
      rightPriceScale: { borderColor: chartTheme.scaleBorder },
      timeScale: {
        borderColor: chartTheme.scaleBorder,
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (t: Time, type: number) => fmtTick(t as number, type, useStore.getState().timeZone),
      },
      localization: {
        timeFormatter: (t: Time) => fmtTime(t as number, { timeZone: useStore.getState().timeZone }),
      },
      crosshair: { vertLine: { color: chartTheme.crosshairFaint }, horzLine: { color: chartTheme.crosshairFaint } },
    });

    const equitySeries = chart.addSeries(AreaSeries, {
      lineColor: mainColor,
      topColor: positive ? 'rgba(34,197,94,0.28)' : 'rgba(239,68,68,0.28)',
      bottomColor: 'rgba(0,0,0,0)',
      lineWidth: 2,
      priceLineVisible: false,
    });

    equitySeries.setData(
      result.equity.map((p) => ({ time: p.time as UTCTimestamp, value: p.equity })),
    );
    const holdSeries = chart.addSeries(LineSeries, {
      color: chartTheme.benchmark,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    holdSeries.setData(result.equity.map((p, i) => ({ time: p.time as UTCTimestamp, value: result.buyHold[i] })));
    equitySeries.createPriceLine({
      price: result.metrics.initialCapital,
      color: chartTheme.refLine,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: 'initial',
    });

    chart.addPane();
    const ddSeries = chart.addSeries(
      HistogramSeries,
      {
        color: 'rgba(239,68,68,0.55)',
        priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(1)}%` },
        priceLineVisible: false,
        lastValueVisible: false,
      },
      1,
    );
    ddSeries.setData(result.equity.map((p) => ({ time: p.time as UTCTimestamp, value: p.drawdownPct })));

    const panes = chart.panes();
    if (panes[0]) panes[0].setStretchFactor(3);
    if (panes[1]) panes[1].setStretchFactor(1);

    chart.timeScale().fitContent();
    chartRef.current = chart;
    return () => {
      chartRef.current = null;
      chart.remove();
    };
  }, [result]);

  /* Zone change: swap the formatters in place, keeping the visible range. */
  useEffect(() => {
    chartRef.current?.applyOptions({
      localization: { timeFormatter: (t: Time) => fmtTime(t as number, { timeZone }) },
      timeScale: { tickMarkFormatter: (t: Time, type: number) => fmtTick(t as number, type, timeZone) },
    });
  }, [timeZone, result]);

  const positive = result.metrics.totalReturnPct >= 0;
  const holdFinal = result.buyHold.length > 0 ? result.buyHold[result.buyHold.length - 1] : result.metrics.initialCapital;
  return (
    <div>
      <div className="equity-legend">
        <span className="equity-legend-item">
          <span className="equity-swatch" style={{ background: positive ? UP_COLOR : DOWN_COLOR }} />
          Strategy <b className="mono">{fmtMoney(result.metrics.finalEquity)}</b>
        </span>
        <span className="equity-legend-item">
          <span className="equity-swatch dashed" style={{ borderTopColor: chartTheme.benchmark }} />
          Buy &amp; hold <b className="mono">{fmtMoney(holdFinal)}</b>
        </span>
      </div>
      <div ref={ref} style={{ height: 240, width: '100%' }} />
    </div>
  );
}
