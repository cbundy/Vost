import { useRef } from 'react';
import { DOCK_DEFAULT, DOCK_MIN, clamp, dockLimits, resolveDockResize } from '../lib/paneSizes';
import { useViewportSize } from '../lib/useViewportSize';
import { useStore, type DockTab } from '../state/store';
import { Splitter } from './Splitter';
import { BacktestTab } from './BacktestTab';
import { PineTab } from './PineTab';
import { OptimizerTab } from './OptimizerTab';
import { ResultsTab } from './ResultsTab';
import { ZoneClock } from './ZoneClock';

export function BottomDock() {
  const tab = useStore((s) => s.dockTab);
  const collapsed = useStore((s) => s.dockCollapsed);
  const setDockTab = useStore((s) => s.setDockTab);
  const setDockCollapsed = useStore((s) => s.setDockCollapsed);
  const pineCount = useStore((s) => s.indicators.filter((i) => i.kind === 'pine').length);
  const pineRunning = useStore((s) => Object.values(s.pineRuns).some((r) => r.running));
  const btResult = useStore((s) => s.btResult);
  const btRunning = useStore((s) => s.btRunning);
  const optResult = useStore((s) => s.optResult);

  const dockHeight = useStore((s) => s.dockHeight);
  const setDockHeight = useStore((s) => s.setDockHeight);
  const viewport = useViewportSize();
  const limits = dockLimits(viewport.height);
  const effective = clamp(dockHeight, limits.min, limits.max);

  // The height the current drag started from, so collapsing by drag keeps the last expanded height.
  const dragStartHeight = useRef(dockHeight);

  const onResize = (raw: number, via: 'drag' | 'key') => {
    const r = resolveDockResize(raw, via, collapsed, dragStartHeight.current, limits);
    if (r.height !== null) setDockHeight(r.height);
    if (r.collapsed !== collapsed) setDockCollapsed(r.collapsed);
  };

  const select = (t: DockTab) => setDockTab(t);
  const tabProps = (t: DockTab) => ({
    role: 'tab' as const,
    id: `dock-tab-${t}`,
    'aria-selected': tab === t && !collapsed,
    'aria-controls': 'dock-panel',
    className: `dock-tab${tab === t && !collapsed ? ' active' : ''}`,
    onClick: () => select(t),
  });

  return (
    <section className={`dock${collapsed ? ' collapsed' : ''}`} style={{ ['--dock-height' as string]: `${effective}px` }}>
      <Splitter
        orientation="horizontal"
        label="Resize bottom panel"
        value={collapsed ? DOCK_MIN : effective}
        min={limits.min}
        max={limits.max}
        onChange={onResize}
        onDragStart={() => {
          dragStartHeight.current = effective;
        }}
        onReset={() => {
          setDockHeight(DOCK_DEFAULT);
          setDockCollapsed(false);
        }}
      />
      <div className="dock-tabs" role="tablist" aria-label="Dock">
        <button {...tabProps('backtest')}>
          <span>⚙</span> Backtest
          {btRunning && <span className="spinner" />}
        </button>
        <button {...tabProps('pine')}>
          <span>{'{ }'}</span> Pine
          {pineRunning && <span className="spinner" />}
          {pineCount > 0 && <span className="badge">{pineCount}</span>}
        </button>
        <button {...tabProps('optimizer')}>
          <span>⛭</span> Optimizer
          {optResult && <span className="badge">{optResult.combos}</span>}
        </button>
        <button {...tabProps('results')}>
          <span>📊</span> Results
          {btResult && <span className="badge blue">{btResult.trades.length} trades</span>}
        </button>
        <div className="dock-spacer" />
        <ZoneClock />
        <button className="ghost icon" title={collapsed ? 'Expand' : 'Collapse'} onClick={() => setDockCollapsed(!collapsed)}>
          {collapsed ? '▲' : '▼'}
        </button>
      </div>
      {!collapsed && (
        <div className={`dock-body${tab === 'pine' ? ' pine' : ''}`} role="tabpanel" id="dock-panel" aria-labelledby={`dock-tab-${tab}`}>
          {tab === 'backtest' && <BacktestTab />}
          {tab === 'pine' && <PineTab />}
          {tab === 'optimizer' && <OptimizerTab />}
          {tab === 'results' && <ResultsTab />}
        </div>
      )}
    </section>
  );
}
