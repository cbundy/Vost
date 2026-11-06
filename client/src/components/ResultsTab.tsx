import { downloadFile, rowsToCsv, sanitizeFileName } from '../lib/export';
import { fmtCompact, fmtDurationBarCount, fmtDurationUnits, fmtMoney, fmtNum, fmtPct, pnlClass } from '../lib/format';
import { medianBarSeconds } from '../lib/backtest/metrics';
import { exitModeLabels } from '../lib/backtest/exits';
import { getStrategy, visibleParams } from '../lib/backtest/strategies';
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
  const shown = new Set(visibleParams(strategy, btResult.config.params).map((p) => p.key));
  const hidden = new Set(strategy.params.filter((p) => !shown.has(p.key)).map((p) => p.key));
  const paramText = Object.entries(btResult.config.params)
    .filter(([k]) => !k.startsWith('__') && !hidden.has(k))
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');

  const profit = m.finalEquity - m.initialCapital;
  const ddUnits = fmtDurationUnits(m.maxDrawdownSeconds, medianBarSeconds(btResult.equity));
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
    { help: 'maxDdDuration', label: 'Max DD duration', value: fmtDurationBarCount(m.maxDrawdownBars), sub: ddUnits.join(' · ') },
    { help: 'exposure', label: 'Exposure', value: fmtPct(m.exposurePct, 1) },
    { help: 'trades', label: 'Trades', value: fmtNum(m.trades, 0) },
    { help: 'signals', label: 'Entry signals', value: m.signalsFired != null ? fmtNum(m.signalsFired, 0) : 'n/a', sub: m.signalsFired != null ? `${m.trades} taken` : undefined },
    {
      help: 'signalRate',
      label: 'Signal rate',
      value: m.signalsPer100Bars != null ? `${fmtNum(m.signalsPer100Bars, 1)} / 100 bars` : 'n/a',
      sub: m.signalsPerDay != null ? `${fmtNum(m.signalsPerDay, 2)} / day` : undefined,
    },
    { help: 'winRate', label: 'Win rate', value: fmtPct(m.winRatePct, 1) },
    { help: 'profitFactor', label: 'Profit factor', value: m.profitFactor === Number.POSITIVE_INFINITY ? '∞' : fmtNum(m.profitFactor, 2) },
    { help: 'expectancy', label: 'Expectancy / trade', value: fmtMoney(m.expectancy), className: pnlClass(m.expectancy) },
    { help: 'avgTrade', label: 'Avg trade', value: fmtPct(m.avgTradePct), className: pnlClass(m.avgTradePct) },
    { help: 'bestWorst', label: 'Best / worst trade', value: `${fmtPct(m.bestTradePct)} / ${fmtPct(m.worstTradePct)}` },
    { help: 'avgBars', label: 'Avg bars in trade', value: fmtNum(m.avgBarsInTrade, 1) },
    { help: 'totalFees', label: 'Total fees', value: fmtMoney(m.totalFees) },
    { help: 'bars', label: 'Bars', value: fmtCompact(btResult.equity.length) },
  ];
  const leverages = btResult.trades.flatMap((t) => (t.leverage != null ? [t.leverage] : []));
  if (btResult.config.riskPct != null && leverages.length > 0) {
    cards.push({ help: 'maxLeverage', label: 'Max leverage', value: `${fmtNum(Math.max(...leverages), 1)}x` });
  }

  const exitBadges = exitModeLabels(btResult.config);

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
        {[exitBadges.stop, exitBadges.target, exitBadges.trail].map((label) => label && <span key={label} className="badge">{label}</span>)}
        {exitBadges.atrLength != null && <span className="badge">ATR {exitBadges.atrLength}{exitBadges.atrTimeframe != null && ` on ${exitBadges.atrTimeframe}x`}</span>}
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

      {btResult.filters && (
        <p className="filters-line mono" data-testid="filters-line">
          Filters: {btResult.filters.signals} entry signals, {btResult.filters.taken} taken
          {btResult.filters.blocked.length > 0 &&
            ` - ${btResult.filters.blocked.map((b) => `${b.label} blocked ${b.blocked}`).join(', ')}`}
        </p>
      )}

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
  sub?: string;
  className?: string;
}

function Metric({ help, label, value, sub, className }: MetricProps) {
  return (
    <MetricTip help={help} as="div" className="metric-card">
      <div className="m-label">{label}</div>
      <div className={`m-value ${className ?? ''}`}>{value}</div>
      {sub ? <div className="m-sub">{sub.split(' · ').map((u, i) => (
        <span key={u}>{i > 0 ? ' · ' : ''}<span className="nowrap">{u}</span></span>
      ))}</div> : null}
    </MetricTip>
  );
}
