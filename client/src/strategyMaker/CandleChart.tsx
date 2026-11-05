import { CandlestickSeries, ColorType, createChart, type UTCTimestamp } from 'lightweight-charts';
import { useEffect, useRef } from 'react';
import type { Candle } from '../../../shared/market.ts';
import { DOWN_COLOR, UP_COLOR, chartTheme } from '../lib/theme';

/** The strategy maker's own candle chart: it pans, zooms and resizes with its box. */
export function CandleChart({ candles }: { candles: Candle[] }) {
  const ref = useRef<HTMLDivElement | null>(null);

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
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
    });
    series.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles]);

  return <div ref={ref} className="sm-chart" role="img" aria-label="Candle chart" />;
}
