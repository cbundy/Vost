import { downloadFile, rowsToCsv, sanitizeFileName } from '../lib/export';
import { fmtCompact, fmtMoney, fmtNum, fmtPct, pnlClass } from '../lib/format';
import { getStrategy } from '../lib/backtest/strategies';
import { BacktestProgress } from './BacktestProgress';
import { MonteCarloPanel } from './MonteCarloPanel';
import { EquityChart } from './EquityChart';
import { TradesTable } from './TradesTable';
import { useChart } from '../state/chartContext';

export function ResultsTab() {
  const btResult = useChart((s) => s.btResult);
  const btRunning = useChart((s) => s.btRunning);
  const dataLabel = useChart((s) => s.dataLabel);
  const showTrades = useChart((s) => s.showTrades);
  const setShowTrades = useChart((s) => s.setShowTrades);
  const clearBacktest = useChart((s) => s.clearBacktest);

  if (btRunning) {
    return (
      <BacktestProgress />
    );
  }

  if (!btResult) {
    return (
      <div className="hint">
        No results yet. Configure a strategy in the <b>Backtest</b> tab and hit <b>Run</b>. Backtests are unlimited — run as many as you
        like, nothing is metered.
      </div>
    );
  }

  const m = btResult.metrics;
  const strategy = getStrategy(btResult.config.strategyId);
  const paramText = Object.entries(btResult.config.params)
    .filter(([k]) => !k.startsWith('__'))
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

  const exportTrades = () => {
    const rows = btResult.trades.map((t) => [
      t.id,
      t.side,
      new Date(t.entryTime * 1000).toISOString(),
      t.entryPrice,
      new Date(t.exitTime * 1000).toISOString(),
      t.exitPrice,
      t.qty,
      t.pnl.toFixed(4),
      t.pnlPct.toFixed(4),
      t.fees.toFixed(4),
      t.bars,
      t.exitReason,
    ]);
    downloadFile(
      `vost_trades_${sanitizeFileName(dataLabel || 'run')}.csv`,
      rowsToCsv(
        ['id', 'side', 'entry_time', 'entry_price', 'exit_time', 'exit_price', 'qty', 'pnl', 'pnl_pct', 'fees', 'bars', 'exit_reason'],
        rows,
      ),
    );
  };

  const exportEquity = () => {
    const rows = btResult.equity.map((p) => [
      new Date(p.time * 1000).toISOString(),
      p.equity.toFixed(4),
      p.drawdownPct.toFixed(4),
      p.position,
    ]);
    downloadFile(
      `vost_equity_${sanitizeFileName(dataLabel || 'run')}.csv`,
      rowsToCsv(['time', 'equity', 'drawdown_pct', 'position'], rows),
    );
  };

  return (
    <div>
      <div className="row mb-3 wrap">
        <span className="badge blue">{strategy.name}</span>
        {paramText && <span className="badge mono">{paramText}</span>}
        <span className="badge">
          fees {btResult.config.feeBps} bps · slippage {btResult.config.slippageBps} bps
        </span>
        {btResult.config.stopLossPct != null && <span className="badge">SL {btResult.config.stopLossPct}%</span>}
        {btResult.config.takeProfitPct != null && <span className="badge">TP {btResult.config.takeProfitPct}%</span>}
        <div className="dock-spacer" />
        <label className="row" style={{ fontSize: 12.5, gap: 6, cursor: 'pointer' }} title="Draw entry/exit markers on the chart">
          <input type="checkbox" checked={showTrades} onChange={(e) => setShowTrades(e.target.checked)} /> Trades on chart
        </label>
        <button onClick={exportTrades}>Export trades CSV</button>
        <button onClick={exportEquity}>Export equity CSV</button>
        <button className="ghost" onClick={clearBacktest}>
          Clear
        </button>
      </div>

      <div className="metrics-grid mb-3">
        <Metric label="Final equity" value={fmtMoney(m.finalEquity)} />
        <Metric label="Net P/L" value={fmtMoney(m.finalEquity - m.initialCapital)} className={pnlClass(m.finalEquity - m.initialCapital)} />
        <Metric label="Total return" value={fmtPct(m.totalReturnPct)} className={pnlClass(m.totalReturnPct)} />
        <Metric label="Buy & hold" value={fmtPct(m.buyHoldPct)} className={pnlClass(m.buyHoldPct)} title="Return of simply holding the asset over the same period" />
        <Metric label="CAGR" value={fmtPct(m.cagrPct)} className={pnlClass(m.cagrPct)} />
        <Metric label="Sharpe" value={fmtNum(m.sharpe, 2)} title="Annualised Sharpe ratio of bar returns" />
        <Metric label="Sortino" value={fmtNum(m.sortino, 2)} title="Annualised Sortino ratio (downside deviation)" />
        <Metric label="Calmar" value={fmtNum(m.calmar, 2)} title="CAGR divided by max drawdown" />
        <Metric label="Max drawdown" value={fmtPct(m.maxDrawdownPct)} className="neg" />
        <Metric label="Max DD duration" value={`${fmtNum(m.maxDrawdownBars, 0)} bars`} />
        <Metric label="Exposure" value={fmtPct(m.exposurePct, 1)} title="Share of bars with an open position" />
        <Metric label="Trades" value={fmtNum(m.trades, 0)} />
        <Metric label="Win rate" value={fmtPct(m.winRatePct, 1)} />
        <Metric
          label="Profit factor"
          value={m.profitFactor === Number.POSITIVE_INFINITY ? '∞' : fmtNum(m.profitFactor, 2)}
          title="Gross profit / gross loss"
        />
        <Metric label="Expectancy / trade" value={fmtMoney(m.expectancy)} className={pnlClass(m.expectancy)} />
        <Metric label="Avg trade" value={fmtPct(m.avgTradePct)} className={pnlClass(m.avgTradePct)} />
        <Metric label="Best / worst trade" value={`${fmtPct(m.bestTradePct)} / ${fmtPct(m.worstTradePct)}`} />
        <Metric label="Avg bars in trade" value={fmtNum(m.avgBarsInTrade, 1)} />
        <Metric label="Total fees" value={fmtMoney(m.totalFees)} />
        <Metric label="Bars" value={fmtCompact(btResult.equity.length)} />
      </div>

      <div className="section-title">Equity curve & drawdown</div>
      <EquityChart result={btResult} />

      <div className="section-title mt-3">Monte Carlo</div>
      <MonteCarloPanel />

      <div className="section-title mt-3">Trade log</div>
      <TradesTable trades={btResult.trades} />
    </div>
  );
}

function Metric({ label, value, className, title }: { label: string; value: string; className?: string; title?: string }) {
  return (
    <div className="metric-card" title={title}>
      <div className="m-label">{label}</div>
      <div className={`m-value ${className ?? ''}`}>{value}</div>
    </div>
  );
}
