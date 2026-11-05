import { useEffect, useRef } from 'react';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { DOWN_COLOR, UP_COLOR } from '../../lib/theme';
import { useStore } from '../../state/store';
import { CountdownPrimitive, type CountdownBar } from './countdownPrimitive';

/** Attaches the countdown label to the candle series and ticks it each second while the page is visible. Not shown in replay. */
export function useBarCountdown(
  chart: IChartApi | null,
  series: ISeriesApi<'Candlestick'> | null,
  getBar: () => CountdownBar | null,
  timeframe: string,
  replayPhase: string | null,
): void {
  const enabled = useStore((s) => s.barCountdown);
  const live = useRef({ getBar, timeframe, on: enabled && replayPhase == null });
  live.current = { getBar, timeframe, on: enabled && replayPhase == null };
  const primRef = useRef<CountdownPrimitive | null>(null);

  useEffect(() => {
    if (!chart || !series) return;
    const prim = new CountdownPrimitive(() => live.current.getBar(), () => live.current.timeframe, () => live.current.on, UP_COLOR, DOWN_COLOR);
    series.attachPrimitive(prim);
    primRef.current = prim;
    const timer = setInterval(() => {
      if (!document.hidden) prim.tick();
    }, 1000);
    return () => {
      clearInterval(timer);
      primRef.current = null;
      try {
        series.detachPrimitive(prim);
      } catch {
        /* the chart is already removed */
      }
    };
  }, [chart, series]);

  useEffect(() => {
    primRef.current?.tick();
  }, [enabled, replayPhase, timeframe]);
}
