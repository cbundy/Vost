import { useEffect, useRef } from 'react';
import type { IChartApi, IPriceLine, ISeriesApi } from 'lightweight-charts';
import { chartTheme, theme } from '../../lib/theme';
import { visibleHighLow } from '../../lib/visibleHighLow';
import { useStore } from '../../state/store';

/** Shows "High" and "Low" labels on the price scale for the highest high and lowest low of the bars on screen. */
export function useVisibleHighLow(chart: IChartApi | null, series: ISeriesApi<'Candlestick'> | null): void {
  const enabled = useStore((s) => s.highLowLabels);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const updateRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!chart || !series) return;
    const make = () =>
      series.createPriceLine({
        price: 0,
        lineVisible: false,
        axisLabelVisible: false,
        title: '',
        axisLabelColor: chartTheme.highLowLabel,
        axisLabelTextColor: theme.text,
      });
    const hi: IPriceLine = make();
    const lo: IPriceLine = make();
    const update = () => {
      try {
        const res = enabledRef.current ? visibleHighLow(series.data() as never, chart.timeScale().getVisibleLogicalRange()) : null;
        if (res) {
          hi.applyOptions({ price: res.high, axisLabelVisible: true, title: 'High' });
          lo.applyOptions({ price: res.low, axisLabelVisible: true, title: 'Low' });
        } else {
          hi.applyOptions({ axisLabelVisible: false, title: '' });
          lo.applyOptions({ axisLabelVisible: false, title: '' });
        }
      } catch {
        /* the chart is already removed */
      }
    };
    updateRef.current = update;
    chart.timeScale().subscribeVisibleLogicalRangeChange(update);
    series.subscribeDataChanged(update);
    update();
    return () => {
      updateRef.current = null;
      try {
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(update);
        series.unsubscribeDataChanged(update);
        series.removePriceLine(hi);
        series.removePriceLine(lo);
      } catch {
        /* the chart is already removed */
      }
    };
  }, [chart, series]);

  useEffect(() => {
    updateRef.current?.();
  }, [enabled]);
}
