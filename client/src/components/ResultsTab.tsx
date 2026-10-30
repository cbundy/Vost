import { downloadFile, rowsToCsv, sanitizeFileName } from '../lib/export';
import { fmtCompact, fmtMoney, fmtNum, fmtPct, pnlClass } from '../lib/format';
import { getStrategy } from '../lib/backtest/strategies';
import { BacktestProgress } from './BacktestProgress';
import { MonteCarloPanel } from './MonteCarloPanel';
import { EquityChart } from './EquityChart';
import { TradesTable } from './TradesTable';
import { BreakdownTables } from './BreakdownTables';
import { MetricTip } from './MetricTip';
import type { HelpKey } from '../lib/backtest/metricHelp';
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

  const profit = m.finalEquity - m.initialCapital;
  const cards: MetricProps[] = [
    { help: 'finalEquity', label: 'Final equity', value: fmtMoney(m.finalEquity) },
    { help: 'netPnl', label: 'Net P/L', value: fmtMoney(profit), className: pnlClass(profit) },
    { help: 'totalReturn', label: 'Total return', value: fmtPct(m.totalReturnPct), className: pnlClass(m.totalReturnPct) },
    { help: 'buyHold', label: 'Buy & hold', value: fmtPct(m.buyHoldPct), className: pnlClass(m.buyHoldPct) },
    { help: 'cagr', label: 'CAGR', value: fmtPct(m.cagrPct), className: pnlClass(m.cagrPct) },
    { help: 'sharpe', label: 'Sharpe', value: fmtNum(m.sharpe, 2) },
    { help: 'sortino', label: 'Sortino', value: fmtNum(m.sortino, 2) },
    { help: 'calmar', label: 'Calmar', value: fmtNum(m.calmar, 2) },
    { help: 'maxDrawdown', label: 'Max drawdown', value: fmtPct(m.maxDrawdownPct), className: 'neg' },
    { help: 'maxDdDuration', label: 'Max DD duration', value: `${fmtNum(m.maxDrawdownBars, 0)} bars` },
    { help: 'exposure', label: 'Exposure', value: fmtPct(m.exposurePct, 1) },
    { help: 'trades', label: 'Trades', value: fmtNum(m.trades, 0) },
    { help: 'winRate', label: 'Win rate', value: fmtPct(m.winRatePct, 1) },
    { help: 'profitFactor', label: 'Profit factor', value: m.profitFactor === Number.POSITIVE_INFINITY ? '∞' : fmtNum(m.profitFactor, 2) },
    { help: 'expectancy', label: 'Expectancy / trade', value: fmtMoney(m.expectancy), className: pnlClass(m.expectancy) },
    { help: 'avgTrade', label: 'Avg trade', value: fmtPct(m.avgTradePct), className: pnlClass(m.avgTradePct) },
    { help: 'bestWorst', label: 'Best / worst trade', value: `${fmtPct(m.bestTradePct)} / ${fmtPct(m.worstTradePct)}` },
    { help: 'avgBars', label: 'Avg bars in trade', value: fmtNum(m.avgBarsInTrade, 1) },
    { help: 'totalFees', label: 'Total fees', value: fmtMoney(m.totalFees) },
    { help: 'bars', label: 'Bars', value: fmtCompact(btResult.equity.length) },
  ];

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
    const rows = btResult.equity.map((p, i) => [
      new Date(p.time * 1000).toISOString(),
      p.equity.toFixed(4),
      p.drawdownPct.toFixed(4),
      p.position,
      (btResult.buyHold[i] ?? 0).toFixed(4),
    ]);
    downloadFile(
      `vost_equity_${sanitizeFileName(dataLabel || 'run')}.csv`,
      rowsToCsv(['time', 'equity', 'drawdown_pct', 'position', 'buy_hold'], rows),
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
        {cards.map((c) => (
          <Metric key={c.help} {...c} />
        ))}
      </div>

      <BreakdownTables trades={btResult.trades} />

      <div className="section-title">Equity curve & drawdown</div>
      <EquityChart result={btResult} />

      <div className="section-title mt-3">Monte Carlo</div>
      <MonteCarloPanel />

      <div className="section-title mt-3">Trade log</div>
      <TradesTable trades={btResult.trades} />
    </div>
  );
}

interface MetricProps {
  help: HelpKey;
  label: string;
  value: string;
  className?: string;
}

function Metric({ help, label, value, className }: MetricProps) {
  return (
    <MetricTip help={help} as="div" className="metric-card">
      <div className="m-label">{label}</div>
      <div className={`m-value ${className ?? ''}`}>{value}</div>
    </MetricTip>
  );
}
