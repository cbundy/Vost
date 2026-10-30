import type { BacktestStage } from '../lib/backtest/types';
import { useChart } from '../state/chartContext';

/** Label of a stage; the percent is shown for the stages that advance bar by bar. */
export function progressLabel(stage: BacktestStage | null, pct: number): string {
  const percent = `${Math.round(pct * 100)}%`;
  switch (stage) {
    case 'signals':
      return 'Computing signals';
    case 'simulating':
      return `Simulating trades ${percent}`;
    case 'pine':
      return `Running Pine script ${percent}`;
    case 'metrics':
      return 'Computing metrics';
    default:
      return 'Starting…';
  }
}

/** Progress bar of the running backtest: fills with the run, names the stage. Indeterminate until the first report. */
export function BacktestProgress() {
  const pct = useChart((s) => s.btProgress);
  const stage = useChart((s) => s.btStage);
  const label = progressLabel(stage, pct);
  const indeterminate = stage == null;
  return (
    <div className="bt-progress">
      <div
        className={`progress${indeterminate ? ' indeterminate' : ''}`}
        style={{ width: '100%' }}
        role="progressbar"
        aria-label="Backtest progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(pct * 100)}
        aria-valuetext={label}
      >
        <div style={indeterminate ? undefined : { width: `${Math.round(pct * 100)}%` }} />
      </div>
      <span className="hint">{label}</span>
    </div>
  );
}
