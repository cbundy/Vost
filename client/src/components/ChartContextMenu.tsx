import { useEffect, useState, type RefObject } from 'react';
import type { ISeriesApi } from 'lightweight-charts';

interface Menu {
  x: number;
  y: number;
  price: number;
  label: string;
}

/**
 * Right-click on the chart: a small menu at the pointer with "Add alert at <price>".
 * The browser's own menu is suppressed over the chart only, and only while data is loaded.
 */
export function ChartContextMenu({
  containerRef,
  seriesRef,
  precision,
  enabled,
  onAddAlert,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  seriesRef: RefObject<ISeriesApi<'Candlestick'> | null>;
  precision: number;
  enabled: boolean;
  onAddAlert: (level: number) => void;
}) {
  const [menu, setMenu] = useState<Menu | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) {
      setMenu(null);
      return;
    }
    const onContext = (ev: MouseEvent): void => {
      const series = seriesRef.current;
      if (!series) return;
      ev.preventDefault();
      const price = series.coordinateToPrice(ev.clientY - el.getBoundingClientRect().top);
      if (price == null) return setMenu(null);
      const label = price.toFixed(precision);
      setMenu({ x: ev.clientX, y: ev.clientY, price: Number(label), label });
    };
    el.addEventListener('contextmenu', onContext);
    return () => el.removeEventListener('contextmenu', onContext);
  }, [containerRef, seriesRef, precision, enabled]);

  useEffect(() => {
    if (!menu) return;
    const close = (): void => setMenu(null);
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') close();
    };
    const onDown = (ev: MouseEvent): void => {
      if (!(ev.target instanceof Element) || !ev.target.closest('.chart-context-menu')) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, [menu]);

  if (!menu) return null;
  return (
    <div className="chart-context-menu" role="menu" style={{ left: menu.x, top: menu.y }}>
      <button
        role="menuitem"
        onClick={() => {
          setMenu(null);
          onAddAlert(menu.price);
        }}
      >
        Add alert at {menu.label}
      </button>
    </div>
  );
}
