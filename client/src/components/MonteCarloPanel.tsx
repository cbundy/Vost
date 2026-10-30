import { downloadFile } from '../lib/export';
import { fmtNum, fmtPct, pnlClass } from '../lib/format';
import { getStrategy } from '../lib/backtest/strategies';
import { MC_MAX_RUNS, MC_MIN_RUNS, MC_MIN_TRADES, type MonteCarloMethod, type Percentiles } from '../lib/backtest/monteCarlo';
import { monteCarloCsv, monteCarloCsvFileName } from '../lib/backtest/monteCarloCsv';
import { useChart } from '../state/chartContext';

const ROWS: Array<[keyof Percentiles, string]> = [
  ['p5', '5th'],
  ['p25', '25th'],
  ['p50', 'Median'],
  ['p75', '75th'],
  ['p95', '95th'],
];

/** A positive percent without a plus sign (drawdowns are depths, not changes). */
const plain = (v: number): string => `${fmtNum(v, 2)}%`;

const ordinal = (n: number): string => {
  const r = Math.round(n);
  const mod = r % 100;
  const suffix = mod >= 11 && mod <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[r % 10] ?? 'th';
  return `${r}${suffix}`;
};

/** Monte Carlo of the finished backtest's trades: settings, percentiles, where the original run falls, chance of a loss. */
export function MonteCarloPanel() {
  const btResult = useChart((s) => s.btResult);
  const dataLabel = useChart((s) => s.dataLabel);
  const cfg = useChart((s) => s.mcConfig);
  const running = useChart((s) => s.mcRunning);
  const error = useChart((s) => s.mcError);
  const mc = useChart((s) => s.mcResult);
  const setMcConfig = useChart((s) => s.setMcConfig);
  const run = useChart((s) => s.runMonteCarlo);
  if (!btResult) return null;

  const current = mc && mc.source === btResult ? mc : null;
  const tradeCount = btResult.trades.length;
  const tooFew = tradeCount < MC_MIN_TRADES;
  const runsBad = !Number.isInteger(cfg.iterations) || cfg.iterations < MC_MIN_RUNS || cfg.iterations > MC_MAX_RUNS;
  const seedBad = !Number.isInteger(cfg.seed);
  const problem = tooFew
    ? `Needs at least ${MC_MIN_TRADES} trades (this run has ${tradeCount}).`
    : runsBad
      ? `Runs must be a whole number from ${MC_MIN_RUNS} to ${fmtNum(MC_MAX_RUNS, 0)}.`
      : seedBad
        ? 'Seed must be a whole number.'
        : null;

  const numInput = (v: number): string => (Number.isFinite(v) ? String(v) : '');
  const parse = (raw: string): number => (raw.trim() === '' ? Number.NaN : Number(raw));

  const exportCsv = () => {
    if (!current) return;
    const strategy = getStrategy(current.source.config.strategyId);
    downloadFile(
      monteCarloCsvFileName(dataLabel),
      monteCarloCsv(current.result, { strategyId: strategy.id, strategyName: strategy.name, params: current.source.config.params }),
    );
  };

  const r = current?.result;
  const maxCount = r ? Math.max(1, ...r.histogram.map((b) => b.count)) : 1;

  return (
    <div className="monte-carlo">
      <div className="form-grid">
        <label className="form-field">
          <span>Runs</span>
          <input
            type="number"
            min={MC_MIN_RUNS}
            max={MC_MAX_RUNS}
            step={1}
            value={numInput(cfg.iterations)}
            onChange={(e) => setMcConfig({ iterations: parse(e.target.value) })}
            aria-invalid={runsBad}
          />
        </label>
        <label className="form-field">
          <span>Method</span>
          <select value={cfg.method} onChange={(e) => setMcConfig({ method: e.target.value as MonteCarloMethod })}>
            <option value="shuffle">Shuffle trade order</option>
            <option value="bootstrap">Resample trades</option>
          </select>
        </label>
        <label className="form-field">
          <span>Seed</span>
          <input type="number" step={1} value={numInput(cfg.seed)} onChange={(e) => setMcConfig({ seed: parse(e.target.value) })} aria-invalid={seedBad} />
        </label>
      </div>
      <div className="row wrap mt-2" style={{ gap: 8 }}>
        <button className="primary" onClick={() => void run()} disabled={running || problem != null}>
          {running ? 'Running…' : 'Run Monte Carlo'}
        </button>
        <button onClick={exportCsv} disabled={!current}>
          Export Monte Carlo CSV
        </button>
      </div>
      {problem && (
        <div className="hint mt-2" role="alert" style={{ color: 'var(--amber)' }}>
          {problem}
        </div>
      )}
      {error && (
        <div className="hint mt-2" role="alert" style={{ color: 'var(--red)' }}>
          Monte Carlo failed: {error}
        </div>
      )}
      {!current && !problem && !running && (
        <div className="hint mt-2">
          Replays this run's {tradeCount} trades {cfg.iterations} times in a different order, or resampled, to show how much of the result was luck.
        </div>
      )}
      {r && (
        <div className="mt-2">
          <div className="hint mb-2">
            {r.iterations.toLocaleString('en-US')} runs · {r.method === 'shuffle' ? 'shuffled trade order' : 'resampled trades'} · seed {r.seed} · {r.trades} trades
          </div>
          <div className="table-wrap">
            <table className="data-table" aria-label="Monte Carlo percentiles">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Percentile</th>
                  <th>Final return</th>
                  <th>Max drawdown (trade to trade)</th>
                </tr>
              </thead>
              <tbody>
                {ROWS.map(([k, label]) => (
                  <tr key={k}>
                    <td style={{ textAlign: 'left' }}>{label}</td>
                    <td className={pnlClass(r.finalReturn[k])}>{fmtPct(r.finalReturn[k])}</td>
                    <td>{plain(r.maxDrawdown[k])}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ textAlign: 'left' }}>This run</td>
                  <td className={pnlClass(r.original.finalReturnPct)}>
                    {fmtPct(r.original.finalReturnPct)} ({ordinal(r.original.finalReturnRankPct)} percentile)
                  </td>
                  <td>
                    {plain(r.original.maxDrawdownPct)} ({ordinal(r.original.maxDrawdownRankPct)} percentile)
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-2" style={{ fontSize: 13 }}>
            Chance of ending at a loss: <b className={r.probLossPct > 0 ? 'neg' : 'pos'}>{fmtNum(r.probLossPct, 1)}%</b>
          </div>
          <div className="mc-hist mt-2" role="img" aria-label="Histogram of final return">
            {r.histogram.map((b, i) => (
              <div
                key={i}
                className={`mc-bar${b.to <= 0 ? ' loss' : ''}`}
                style={{ height: `${(b.count / maxCount) * 100}%` }}
                title={`${fmtPct(b.from)} to ${fmtPct(b.to)}: ${b.count} runs`}
              />
            ))}
          </div>
          <div className="row mc-hist-axis">
            <span>{fmtPct(r.histogram[0].from)}</span>
            <div className="dock-spacer" />
            <span>Final return</span>
            <div className="dock-spacer" />
            <span>{fmtPct(r.histogram[r.histogram.length - 1].to)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
