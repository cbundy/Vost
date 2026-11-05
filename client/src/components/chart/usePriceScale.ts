import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { IChartApi } from 'lightweight-charts';
import { lightweightMode, type PriceScaleModeId } from '../../lib/priceScaleMode';

/** Where the A/L buttons sit, in px from the chart container's top-left corner. */
export interface PriceScaleBox {
  left: number;
  top: number;
  width: number;
}

const BUTTON_SIZE = 22;
const BUTTON_GAP = 2;
const BUTTON_INSET = 6;
/** The smallest scale width that holds both buttons. */
const BOX_WIDTH = BUTTON_SIZE * 2 + BUTTON_GAP + 4;

export interface PriceScaleControl {
  /** Whether the main scale fits the visible data (read from the chart, not remembered). */
  auto: boolean;
  setAuto(on: boolean): void;
  /** Reads the main scale's real auto state again (after a drag, wheel, double click or a reset). */
  refresh(): void;
  /** Set while the pointer is over the main pane's price scale (or a tap landed there). */
  box: PriceScaleBox | null;
  /** The buttons report the pointer entering and leaving them, so moving onto them keeps them shown. */
  holdButtons(over: boolean): void;
}

/**
 * The main pane's price scale mode and auto fit: applies the chart's saved mode to the `right` scale of pane 0 (on
 * change and whenever the chart is created), tracks `autoScale`, and works out where the hover-only A/L buttons go.
 */
export function usePriceScale(chartApi: IChartApi | null, containerRef: RefObject<HTMLDivElement | null>, mode: PriceScaleModeId): PriceScaleControl {
  const [auto, setAutoState] = useState(true);
  const [box, setBox] = useState<PriceScaleBox | null>(null);
  const overScale = useRef(false);
  const overButtons = useRef(false);

  const refresh = useCallback(() => {
    if (!chartApi) return;
    try {
      setAutoState(chartApi.priceScale('right', 0).options().autoScale);
    } catch {
      // the chart is gone
    }
  }, [chartApi]);

  useEffect(() => {
    if (!chartApi) return;
    chartApi.priceScale('right', 0).applyOptions({ mode: lightweightMode(mode) });
    refresh();
  }, [chartApi, mode, refresh]);

  const setAuto = useCallback(
    (on: boolean) => {
      if (!chartApi) return;
      chartApi.priceScale('right', 0).applyOptions({ autoScale: on });
      refresh();
    },
    [chartApi, refresh],
  );

  const place = useCallback((): PriceScaleBox | null => {
    const el = containerRef.current;
    if (!chartApi || !el) return null;
    const scaleWidth = chartApi.priceScale('right', 0).width();
    const paneHeight = chartApi.panes()[0]?.getHeight() ?? 0;
    if (scaleWidth <= 0 || paneHeight <= 0) return null;
    const width = Math.max(scaleWidth, BOX_WIDTH);
    return {
      left: el.offsetLeft + el.clientWidth - width,
      top: el.offsetTop + paneHeight - BUTTON_SIZE - BUTTON_INSET,
      width,
    };
  }, [chartApi, containerRef]);

  const sync = useCallback(() => {
    const next = overScale.current || overButtons.current ? place() : null;
    setBox((prev) => (prev && next && prev.left === next.left && prev.top === next.top && prev.width === next.width ? prev : next));
  }, [place]);

  useEffect(() => {
    const el = containerRef.current;
    if (!chartApi || !el) return;
    /** Whether a point (client px) is on the main pane's price scale. */
    const onScale = (clientX: number, clientY: number): boolean => {
      const r = el.getBoundingClientRect();
      const scaleWidth = chartApi.priceScale('right', 0).width();
      const paneHeight = chartApi.panes()[0]?.getHeight() ?? 0;
      return scaleWidth > 0 && clientX >= r.right - scaleWidth && clientX <= r.right && clientY >= r.top && clientY < r.top + paneHeight;
    };
    const onMove = (ev: PointerEvent): void => {
      if (ev.pointerType !== 'mouse') return;
      const over = onScale(ev.clientX, ev.clientY);
      if (over === overScale.current && !over) return;
      overScale.current = over;
      sync();
    };
    const onLeave = (ev: PointerEvent): void => {
      if (ev.pointerType !== 'mouse') return;
      overScale.current = false;
      sync();
    };
    /* No hover on touch: a tap on the scale shows the buttons until the next tap elsewhere. */
    const onDown = (ev: PointerEvent): void => {
      if (ev.pointerType === 'mouse') return;
      overScale.current = onScale(ev.clientX, ev.clientY);
      sync();
    };
    const onTouchAway = (ev: PointerEvent): void => {
      if (ev.pointerType === 'mouse' || (ev.target instanceof Element && ev.target.closest('.price-scale-buttons'))) return;
      if (el.contains(ev.target as Node)) return;
      overScale.current = false;
      sync();
    };
    /* A drag of the scale turns auto off, a double click on it turns it on, and the wheel may too. */
    const reread = (): void => refresh();
    const onUp = (): void => {
      refresh();
      requestAnimationFrame(refresh);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('wheel', reread, { passive: true });
    el.addEventListener('dblclick', onUp);
    window.addEventListener('pointerdown', onTouchAway, true);
    return () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('wheel', reread);
      el.removeEventListener('dblclick', onUp);
      window.removeEventListener('pointerdown', onTouchAway, true);
    };
  }, [chartApi, containerRef, refresh, sync]);

  const holdButtons = useCallback(
    (over: boolean) => {
      overButtons.current = over;
      sync();
    },
    [sync],
  );

  return { auto, setAuto, refresh, box, holdButtons };
}

export { BUTTON_SIZE, BUTTON_GAP };
