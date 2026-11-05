/** Checks of the chosen candidate on data it was not chosen on. */
import { MAX_GRID_COMBOS, paramValues, type OptimizeRow, type SweepParam } from '../../lib/backtest/optimizer';
import { runMonteCarlo, MC_MIN_TRADES } from '../../lib/backtest/monteCarlo';
import { robustnessScores } from '../../lib/backtest/robustness';
import { getStrategy } from '../../lib/backtest/strategies';
import type { BacktestConfig } from '../../lib/backtest/types';
import { walkForwardProblem, walkForwardWindows, type WalkForwardConfig } from '../../lib/backtest/walkForward';
import type { Candle } from '../../types';
import { gapsOf, runParts } from './backtest';
import type { Candidate, Targets, Validation, ValidationCheck } from './types';

export const WALK_FORWARD: WalkForwardConfig = { method: 'walk-forward', windows: 4, inSamplePct: 70, anchored: true };
export const MC_ITERATIONS = 500;
export const MC_SEED = 1;
export const ROBUST_RADIUS = 1;

/** The most neighbours (one step each side per swept parameter) a candidate with `keys` swept parameters has. */
export const neighbourCount = (keys: number): number => 3 ** keys;

/** Backtests the validation does for one chosen candidate on `seriesCount` series, at most. */
export function validationBacktests(seriesCount: number, sweptKeys: number): number {
  // Walk-forward windows, the neighbour grid, and the Monte Carlo selection and held-out runs.
  return seriesCount * (WALK_FORWARD.windows + neighbourCount(sweptKeys) + 2);
}

/** Sweeps around the candidate: one step each side of each swept value, within the parameter's own limits. */
export function neighbourSweeps(strategyId: string, params: Record<string, number>, sweeps: SweepParam[]): SweepParam[] {
  const specs = getStrategy(strategyId).params;
  return sweeps.map((s) => {
    const spec = specs.find((p) => p.key === s.key);
    const step = Math.abs(s.step) || 1;
    const v = params[s.key];
    return {
      key: s.key,
      from: Math.max(spec?.min ?? -Infinity, v - step),
      to: Math.min(spec?.max ?? Infinity, v + step),
      step,
    };
  });
}

function combos(sweeps: SweepParam[]): Array<Record<string, number>> {
  let out: Array<Record<string, number>> = [{}];
  for (const s of sweeps) out = out.flatMap((o) => paramValues(s).map((v) => ({ ...o, [s.key]: v })));
  return out;
}

export interface ValidateArgs {
  candidate: Candidate;
  /** The sweeps the candidate came from (without direction). */
  sweeps: SweepParam[];
  targets: Targets;
  base: BacktestConfig;
  fullSeries: Candle[][];
  /** The first 70% of each series (where the candidate was chosen). */
  selection: Candle[][];
  /** The last 30% of each series. */
  heldOut: Candle[][];
  /** Whether a parameter set is a valid candidate of the family (for example fast below slow). */
  valid: (params: Record<string, number>) => boolean;
  checkAbort: () => void;
}

export function validateCandidate(a: ValidateArgs): Validation {
  const { candidate, targets, base } = a;
  const checks: ValidationCheck[] = [];

  const heldOutGaps = gapsOf(candidate.heldOut, targets);
  checks.push({
    id: 'held-out',
    passed: heldOutGaps.length === 0 && candidate.heldOut.trades > 0,
    detail:
      candidate.heldOut.trades === 0
        ? 'no trades on the held-out 30%'
        : heldOutGaps.length
          ? heldOutGaps.map((g) => g.text).join('; ')
          : 'R:R, hit rate and drawdown are within the targets on the held-out 30%',
  });

  // Walk-forward: the fixed parameters on each window's held-out stretch.
  a.checkAbort();
  let profitable = 0;
  let windowsRun = 0;
  for (const candles of a.fullSeries) {
    if (walkForwardProblem(WALK_FORWARD, candles.length)) continue;
    for (const w of walkForwardWindows(candles.length, WALK_FORWARD)) {
      const r = runParts([candles.slice(w.heldOut.from, w.heldOut.to)], base, candidate.strategyId, candidate.params);
      windowsRun++;
      if (r.stats.trades > 0 && r.stats.totalReturnPct > 0) profitable++;
    }
  }
  checks.push(
    windowsRun === 0
      ? { id: 'walk-forward', passed: false, detail: 'not enough bars for walk-forward windows' }
      : { id: 'walk-forward', passed: profitable * 2 >= windowsRun, detail: `${profitable} of ${windowsRun} windows were profitable` },
  );

  // Robustness: held-out return of the neighbouring settings, backtested for real.
  a.checkAbort();
  const nSweeps = neighbourSweeps(candidate.strategyId, candidate.params, a.sweeps);
  const rows: OptimizeRow[] = [];
  const fixed = Object.fromEntries(Object.entries(candidate.params).filter(([k]) => !a.sweeps.some((s) => s.key === k)));
  if (neighbourCount(a.sweeps.length) * a.fullSeries.length <= MAX_GRID_COMBOS) {
    for (const p of combos(nSweeps)) {
      const params = { ...fixed, ...p };
      if (!a.valid(params)) continue;
      const r = runParts(a.heldOut, base, candidate.strategyId, params);
      if (!r.lead) continue;
      rows.push({ params: p, metrics: { ...r.lead, totalReturnPct: r.stats.totalReturnPct }, value: r.stats.totalReturnPct });
    }
  }
  const idx = rows.findIndex((r) => a.sweeps.every((s) => r.params[s.key] === candidate.params[s.key]));
  const score = idx >= 0 ? robustnessScores(rows, nSweeps, ROBUST_RADIUS)[idx] : null;
  checks.push(
    !score || score.neighbourMean == null
      ? { id: 'robustness', passed: false, detail: 'no neighbouring settings could be tested' }
      : {
          id: 'robustness',
          passed: score.neighbourMean > 0,
          detail: `${score.neighbourCount} neighbouring settings averaged ${score.neighbourMean.toFixed(1)}% return on the held-out 30%`,
        },
  );

  // Monte Carlo on the candidate's trades (selection and held-out together).
  a.checkAbort();
  const sel = runParts(a.selection, base, candidate.strategyId, candidate.params);
  const ho = runParts(a.heldOut, base, candidate.strategyId, candidate.params);
  const trades = [...sel.trades, ...ho.trades];
  if (trades.length < Math.max(MC_MIN_TRADES, 2)) {
    checks.push({ id: 'monte-carlo', passed: false, detail: 'too few trades to reshuffle' });
  } else {
    const mc = runMonteCarlo({ trades, initialCapital: base.initialCapital }, { iterations: MC_ITERATIONS, method: 'shuffle', seed: MC_SEED });
    const ddOk = targets.maxDrawdownPct == null || mc.maxDrawdown.p95 <= targets.maxDrawdownPct;
    checks.push({
      id: 'monte-carlo',
      passed: mc.probLossPct <= 50 && ddOk,
      detail: `${mc.probLossPct.toFixed(0)}% of ${MC_ITERATIONS} reshuffles lose money; 95th percentile drawdown ${mc.maxDrawdown.p95.toFixed(1)}%`,
    });
  }

  return { candidate, heldOutGaps, checks, validated: checks[0].passed };
}
