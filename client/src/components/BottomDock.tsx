import { useState } from 'react';
import { useStore } from '../state/store';
import { BacktestTab } from './BacktestTab';
import { OptimizerTab } from './OptimizerTab';
import { ResultsTab } from './ResultsTab';
import { ZoneClock } from './ZoneClock';

type Tab = 'backtest' | 'optimizer' | 'results';

export function BottomDock() {
  const [tab, setTab] = useState<Tab>('backtest');
  const [collapsed, setCollapsed] = useState(false);
  const btResult = useStore((s) => s.btResult);
  const btRunning = useStore((s) => s.btRunning);
  const optResult = useStore((s) => s.optResult);

  const select = (t: Tab) => {
    setTab(t);
    setCollapsed(false);
  };

  return (
    <section className={`dock${collapsed ? ' collapsed' : ''}`}>
      <div className="dock-tabs">
        <button className={`dock-tab${tab === 'backtest' && !collapsed ? ' active' : ''}`} onClick={() => select('backtest')}>
          <span>⚙</span> Backtest
          {btRunning && <span className="spinner" />}
        </button>
        <button className={`dock-tab${tab === 'optimizer' && !collapsed ? ' active' : ''}`} onClick={() => select('optimizer')}>
          <span>⛭</span> Optimizer
          {optResult && <span className="badge">{optResult.combos}</span>}
        </button>
        <button className={`dock-tab${tab === 'results' && !collapsed ? ' active' : ''}`} onClick={() => select('results')}>
          <span>📊</span> Results
          {btResult && <span className="badge blue">{btResult.trades.length} trades</span>}
        </button>
        <div className="dock-spacer" />
        <ZoneClock />
        <button className="ghost icon" title={collapsed ? 'Expand' : 'Collapse'} onClick={() => setCollapsed((v) => !v)}>
          {collapsed ? '▲' : '▼'}
        </button>
      </div>
      {!collapsed && (
        <div className="dock-body">
          {tab === 'backtest' && <BacktestTab />}
          {tab === 'optimizer' && <OptimizerTab />}
          {tab === 'results' && <ResultsTab />}
        </div>
      )}
    </section>
  );
}
