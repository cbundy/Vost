import { useEffect, useRef, useState } from 'react';
import { ChartPanel } from './ChartPanel';
import { ChartSwitcher } from './ChartSwitcher';
import { Splitter } from './Splitter';
import { DRAWER_QUERY } from '../lib/paneSizes';
import {
  DEFAULT_ARRANGEMENT_ID,
  MIN_CELL_HEIGHT,
  MIN_CELL_WIDTH,
  boundaryLimits,
  dividers,
  evenSizes,
  getArrangement,
  moveBoundary,
  trackStart,
  type Axis,
  type Divider,
} from '../lib/layouts';
import { useMediaQuery } from '../lib/useMediaQuery';
import { ChartStoreProvider } from '../state/chartContext';
import { useStore } from '../state/store';

/** The size of an element, kept current. */
function useElementSize() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

const trackCss = (tracks: number[]) => tracks.map((f) => `minmax(0, ${(f * 1000).toFixed(3)}fr)`).join(' ');

/**
 * The chart area: one cell per chart in the arrangement, each bound to its own chart store, with draggable edges
 * between cells. A press anywhere in a cell makes that chart the active one. On a narrow screen only the active
 * chart shows (the others stay mounted, so their data and live streams carry on) and a switcher picks it.
 */
export function ChartGrid({ onImportCsv, onAddAlert }: { onImportCsv: () => void; onAddAlert: (level: number) => void }) {
  const arrangement = getArrangement(useStore((s) => s.arrangementId)) ?? getArrangement(DEFAULT_ARRANGEMENT_ID)!;
  const order = useStore((s) => s.chartOrder);
  const charts = useStore((s) => s.charts);
  const activeId = useStore((s) => s.activeChartId);
  const sizes = useStore((s) => s.layoutSizes);
  const setActiveChart = useStore((s) => s.setActiveChart);
  const setLayoutSizes = useStore((s) => s.setLayoutSizes);
  const narrow = useMediaQuery(DRAWER_QUERY);
  const [stageRef, stage] = useElementSize();
  const multi = order.length > 1;
  const fits = order.length === arrangement.count && sizes.cols.length === arrangement.cols && sizes.rows.length === arrangement.rows;
  const tracks = fits ? sizes : evenSizes(arrangement);
  const showGrid = !narrow;

  const px = (axis: Axis) => (axis === 'col' ? stage.width : stage.height);
  const minShare = (axis: Axis) => {
    const total = px(axis);
    return total > 0 ? (axis === 'col' ? MIN_CELL_WIDTH : MIN_CELL_HEIGHT) / total : 0;
  };

  const drag = (axis: Axis, at: number, share: number) => {
    const t = axis === 'col' ? tracks.cols : tracks.rows;
    const next = moveBoundary(arrangement, axis, t, at, share, minShare(axis));
    setLayoutSizes(axis === 'col' ? { ...tracks, cols: next } : { ...tracks, rows: next });
  };

  const divider = (d: Divider) => {
    const t = d.axis === 'col' ? tracks.cols : tracks.rows;
    const other = d.axis === 'col' ? tracks.rows : tracks.cols;
    const total = px(d.axis);
    const pos = trackStart(t, d.at);
    const { lo, hi } = boundaryLimits(arrangement, d.axis, t, d.at, minShare(d.axis));
    const along = trackStart(other, d.from) * 100;
    const length = (trackStart(other, d.to) - trackStart(other, d.from)) * 100;
    const style =
      d.axis === 'col'
        ? { left: `calc(${pos * 100}% - 3px)`, top: `${along}%`, height: `${length}%`, width: 6 }
        : { top: `calc(${pos * 100}% - 3px)`, left: `${along}%`, width: `${length}%`, height: 6 };
    // A column edge's value is its distance from the left; a row edge's is the space below it (the splitter grows upward).
    const value = d.axis === 'col' ? pos * total : (1 - pos) * total;
    const toShare = (n: number) => (d.axis === 'col' ? n / total : 1 - n / total);
    return (
      <div key={`${d.axis}-${d.at}-${d.from}`} className="grid-divider" style={style}>
        <Splitter
          orientation={d.axis === 'col' ? 'vertical' : 'horizontal'}
          label={d.axis === 'col' ? 'Resize chart columns' : 'Resize chart rows'}
          value={value}
          min={d.axis === 'col' ? lo * total : (1 - hi) * total}
          max={d.axis === 'col' ? hi * total : (1 - lo) * total}
          onChange={(n) => total > 0 && drag(d.axis, d.at, toShare(n))}
          onReset={() => setLayoutSizes(evenSizes(arrangement))}
        />
      </div>
    );
  };

  return (
    <div className="chart-grid-root">
      {narrow && multi && <ChartSwitcher />}
      <div
        className={`chart-grid${narrow ? ' stacked' : ''}`}
        ref={stageRef}
        style={showGrid ? { gridTemplateColumns: trackCss(tracks.cols), gridTemplateRows: trackCss(tracks.rows) } : undefined}
      >
        {order.map((id, i) => {
          const store = charts[id];
          const cell = arrangement.cells[i];
          if (!store || !cell) return null;
          const active = id === activeId;
          return (
            <div
              key={id}
              className={`chart-cell${multi && active ? ' active' : ''}${narrow && !active ? ' away' : ''}`}
              data-chart-id={id}
              data-active={active ? 'true' : 'false'}
              style={showGrid ? { gridColumn: `${cell.col + 1} / span ${cell.colSpan}`, gridRow: `${cell.row + 1} / span ${cell.rowSpan}` } : undefined}
              onPointerDownCapture={() => setActiveChart(id)}
            >
              <ChartStoreProvider store={store}>
                <ChartPanel active={active} onImportCsv={onImportCsv} onAddAlert={onAddAlert} />
              </ChartStoreProvider>
            </div>
          );
        })}
        {showGrid && multi && fits && <div className="grid-dividers">{dividers(arrangement).map(divider)}</div>}
      </div>
    </div>
  );
}
