import { useEffect, useRef, useState } from 'react';
import { useStore as useZustand } from 'zustand';
import { useTopKeydown } from '../lib/useDialogKeys';
import type { ChartStore } from '../state/chart';
import { useStore } from '../state/store';

function ChartName({ store }: { store: ChartStore }) {
  const symbol = useZustand(store, (s) => s.symbol);
  const timeframe = useZustand(store, (s) => s.timeframe);
  return <>{symbol} · {timeframe}</>;
}

/** The narrow screen's way to change the active chart: "2 / 4" with previous and next, and a list of the charts. */
export function ChartSwitcher() {
  const order = useStore((s) => s.chartOrder);
  const charts = useStore((s) => s.charts);
  const activeId = useStore((s) => s.activeChartId);
  const setActiveChart = useStore((s) => s.setActiveChart);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const index = Math.max(0, order.indexOf(activeId));

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  useTopKeydown(open, (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      setOpen(false);
    }
  });

  const go = (to: number) => setActiveChart(order[(to + order.length) % order.length]);

  return (
    <div className="chart-switcher" ref={wrapRef}>
      <button className="ghost icon" aria-label="Previous chart" title="Previous chart" onClick={() => go(index - 1)}>‹</button>
      <button className="ghost chart-switcher-count" aria-haspopup="listbox" aria-expanded={open} aria-label="Choose chart" onClick={() => setOpen((v) => !v)}>
        {index + 1} / {order.length}
        <span className="chart-switcher-name">
          {charts[activeId] && <ChartName store={charts[activeId]} />}
        </span>
      </button>
      <button className="ghost icon" aria-label="Next chart" title="Next chart" onClick={() => go(index + 1)}>›</button>
      {open && (
        <div className="chart-switcher-menu" role="listbox" aria-label="Charts">
          {order.map((id, i) => (
            <button
              key={id}
              role="option"
              aria-selected={id === activeId}
              className={id === activeId ? 'selected' : ''}
              onClick={() => {
                setActiveChart(id);
                setOpen(false);
              }}
            >
              <span className="muted-2">{i + 1}</span> <ChartName store={charts[id]} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
