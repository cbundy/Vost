/** The search: tries the built-in strategies over ranges of settings and scores them against the highlights. */
import { gridSize, MAX_GRID_COMBOS, paramValues, type SweepParam } from '../../lib/backtest/optimizer';
import { buildSignals, composedEntryKeys, DEFAULT_PARAMS, getStrategy } from '../../lib/backtest/strategies';
import { defaultBacktestConfig, type BacktestConfig } from '../../lib/backtest/types';
import { splitBars } from '../../lib/backtest/validation';
import { gapSize, gapsOf, runParts } from './backtest';
import { marksFromTrades, marksBefore, marksOf, scoreOf, tally, type Marks, type MatchTally } from './match';
import {
  MIN_TRADES,
  SIGNAL_FAMILIES,
  type Candidate,
  type SearchInput,
  type SearchOutcome,
  type SearchStage,
  type SkippedTrade,
} from './types';
import { validateCandidate, validationBacktests } from './validate';

export const SELECTION_PCT = 70;
export const DEFAULT_TOLERANCE = 3;
export const DEFAULT_TOP_N = 8;

const DIRECTION_VALUE = { long: 1, short: 2, both: 3 } as const;

/** The default ranges per family (coarse, so a run stays well under the grid cap). */
export const DEFAULT_SPACE: Record<string, SweepParam[]> = {
  sma_cross: [
    { key: 'fast', from: 2, to: 30, step: 2 },
    { key: 'slow', from: 10, to: 80, step: 4 },
  ],
  ema_cross: [
    { key: 'fast', from: 2, to: 30, step: 2 },
    { key: 'slow', from: 10, to: 80, step: 4 },
  ],
  macd_cross: [
    { key: 'fast', from: 4, to: 20, step: 2 },
    { key: 'slow', from: 16, to: 40, step: 4 },
    { key: 'signal', from: 5, to: 13, step: 4 },
  ],
  rsi_reversion: [
    { key: 'length', from: 5, to: 30, step: 5 },
    { key: 'oversold', from: 20, to: 40, step: 5 },
    { key: 'overbought', from: 60, to: 80, step: 5 },
  ],
  bollinger: [
    { key: 'length', from: 10, to: 50, step: 10 },
    { key: 'mult', from: 1.5, to: 2.5, step: 0.5 },
    { key: 'mode', from: 0, to: 1, step: 1 },
  ],
  donchian: [
    { key: 'entry', from: 10, to: 60, step: 5 },
    { key: 'exit', from: 5, to: 30, step: 5 },
  ],
  // At most 400 raw combinations: 3 x 3 x 3 x 3 x 2 x 2 = 324.
  composed: [
    { key: 'fast', from: 5, to: 15, step: 5 },
    { key: 'slow', from: 20, to: 60, step: 20 },
    { key: 'trendFilter', from: 0, to: 2, step: 1 },
    { key: 'trendLen', from: 100, to: 200, step: 50 },
    { key: 'adxFilter', from: 0, to: 1, step: 1 },
    { key: 'adxMin', from: 20, to: 30, step: 10 },
  ],
};

/** Composed: the entry rule's own ordering holds, and settings that do nothing stay at their default (no duplicate runs). */
function validComposed(p: Record<string, number>): boolean {
  const rule = Math.round(p.entryRule);
  if (rule < 1 || rule > 6) return false;
  if (rule <= 3 && !(p.fast < p.slow)) return false;
  if (rule === 4 && !(p.oversold < p.overbought)) return false;
  const used = new Set(composedEntryKeys(rule));
  const specs = getStrategy('composed').params;
  const unused = (key: string, gate: string, on: number[]): boolean => !on.includes(Math.round(p[gate]));
  for (const spec of specs) {
    if (spec.key === 'entryRule' || spec.key === 'direction') continue;
    const entryKey = ['fast', 'slow', 'signal', 'length', 'oversold', 'overbought', 'mult', 'mode', 'entry', 'exit'].includes(spec.key);
    const idle = entryKey
      ? !used.has(spec.key)
      : spec.visibleWhen != null && unused(spec.key, spec.visibleWhen.key, spec.visibleWhen.values);
    if (idle && p[spec.key] !== spec.default) return false;
  }
  return true;
}

/** Whether a parameter set makes sense for the family (a fast average must be faster than the slow one). */
export function validParams(strategyId: string, p: Record<string, number>): boolean {
  if (strategyId === 'sma_cross' || strategyId === 'ema_cross' || strategyId === 'macd_cross') return p.fast < p.slow;
  if (strategyId === 'rsi_reversion') return p.oversold < p.overbought;
  if (strategyId === 'composed') return validComposed(p);
  return true;
}

function abortError(): Error {
  return new DOMException('The search was cancelled', 'AbortError');
}

const yieldNow = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export interface Raw {
  strategyId: string;
  params: Record<string, number>;
}

export function* candidatesOf(strategyId: string, sweeps: SweepParam[], direction: number): Generator<Raw> {
  const base: Record<string, number> = { ...DEFAULT_PARAMS[strategyId], direction };
  const axes = sweeps.map(paramValues);
  const idx = new Array<number>(sweeps.length).fill(0);
  for (;;) {
    const params = { ...base };
    sweeps.forEach((s, i) => (params[s.key] = axes[i][idx[i]]));
    if (validParams(strategyId, params)) yield { strategyId, params };
    let a = sweeps.length - 1;
    while (a >= 0 && ++idx[a] === axes[a].length) idx[a--] = 0;
    if (a < 0) return;
  }
}

const paramsChanged = (c: Raw): number =>
  Object.entries(c.params).filter(([k, v]) => k !== 'direction' && v !== DEFAULT_PARAMS[c.strategyId][k]).length;

/** Runs the search. Resolves with the outcome; rejects with an AbortError when `signal` aborts. */
export async function runSearch(input: SearchInput): Promise<SearchOutcome> {
  const { series, targets, direction, signal, onProgress } = input;
  const tolerance = input.tolerance ?? DEFAULT_TOLERANCE;
  const topN = Math.max(1, Math.floor(input.topN ?? DEFAULT_TOP_N));
  const families = input.families ?? [...SIGNAL_FAMILIES];
  const refuse = (reason: string): SearchOutcome => ({ kind: 'refused', reason });
  const checkAbort = (): void => {
    if (signal?.aborted) throw abortError();
  };

  if (series.length === 0) return refuse('Give at least one chart with highlighted trades.');
  if (families.length === 0) return refuse('Pick at least one strategy family.');
  for (const id of families) {
    if (!(SIGNAL_FAMILIES as readonly string[]).includes(id)) {
      return refuse(`Unknown strategy family "${id}". The search can use: ${SIGNAL_FAMILIES.join(', ')}.`);
    }
  }
  const spaces = new Map<string, SweepParam[]>();
  for (const id of new Set(families)) {
    const sweeps = input.space?.[id] ?? DEFAULT_SPACE[id];
    const known = getStrategy(id).params.map((p) => p.key);
    for (const s of sweeps) {
      if (s.key === 'direction') return refuse('Direction is set by the direction input, not by a range.');
      if (!known.includes(s.key)) return refuse(`${id} has no setting "${s.key}".`);
    }
    if (new Set(sweeps.map((s) => s.key)).size !== sweeps.length) return refuse(`${id} has a setting listed twice.`);
    if (sweeps.some((s) => gridSize({ sweeps: [s] }) === 0)) return refuse(`${id} has a range that is not a number.`);
    spaces.set(id, sweeps);
  }

  // Trades to bars by time.
  const skipped: SkippedTrade[] = [];
  const perSeries = series.map((s, i) => marksFromTrades(s.candles, s.trades, i, direction, skipped));
  const have = perSeries.reduce((a, m) => a + m.used, 0);
  if (have < MIN_TRADES) return { kind: 'too-few', have, need: MIN_TRADES, skipped };

  // Grid cap, before any work.
  let candidateCount = 0;
  let maxKeys = 0;
  for (const sweeps of spaces.values()) {
    candidateCount += gridSize({ sweeps });
    maxKeys = Math.max(maxKeys, sweeps.length);
  }
  const S = series.length;
  const backtests = candidateCount * S + Math.min(topN, candidateCount) * S * 2 + validationBacktests(S, maxKeys);
  if (backtests > MAX_GRID_COMBOS) {
    return refuse(
      `This search needs ${backtests.toLocaleString('en-US')} backtests (${candidateCount.toLocaleString('en-US')} settings x ${S} chart${S === 1 ? '' : 's'} plus checks); the limit is ${MAX_GRID_COMBOS.toLocaleString('en-US')}. Narrow the ranges.`,
    );
  }

  const base: BacktestConfig = {
    ...defaultBacktestConfig(),
    ...input.risk,
    allowShort: direction !== 'long',
  };
  const splits = series.map((s) => splitBars(s.candles, SELECTION_PCT));
  const truth: Marks[] = perSeries.map((m, i) => marksBefore(m.marks, splits[i].inSample.length));

  // Score every candidate on the selection part only.
  const dirValue = DIRECTION_VALUE[direction];
  const all: Raw[] = [];
  for (const id of new Set(families)) all.push(...candidatesOf(id, spaces.get(id) as SweepParam[], dirValue));
  const scored: Array<Raw & { match: ReturnType<typeof scoreOf>; changed: number }> = [];
  let lastPct = -1;
  const report = (pct: number, stage: SearchStage): void => onProgress?.(pct, stage);
  for (let i = 0; i < all.length; i++) {
    checkAbort();
    const pct = Math.floor((100 * i) / all.length);
    if (pct !== lastPct) {
      lastPct = pct;
      report(0.9 * (i / all.length), 'scoring');
      await yieldNow();
      checkAbort();
    }
    const c = all[i];
    const tallies: MatchTally[] = splits.map((sp, k) => tally(marksOf(buildSignals(sp.inSample, c.strategyId, c.params)), truth[k], tolerance));
    scored.push({ ...c, match: scoreOf(tallies), changed: paramsChanged(c) });
  }
  scored.sort(
    (a, b) =>
      b.match.f1 - a.match.f1 ||
      a.changed - b.changed ||
      (a.strategyId < b.strategyId ? -1 : a.strategyId > b.strategyId ? 1 : 0) ||
      (JSON.stringify(a.params) < JSON.stringify(b.params) ? -1 : JSON.stringify(a.params) > JSON.stringify(b.params) ? 1 : 0),
  );

  // Backtest the best matches on the selection part and on the held-out part.
  const selectionParts = splits.map((s) => s.inSample);
  const heldOutParts = splits.map((s) => s.heldOut);
  const top: Candidate[] = [];
  const topRaw = scored.slice(0, topN);
  for (let i = 0; i < topRaw.length; i++) {
    checkAbort();
    report(0.9 + 0.05 * (i / topRaw.length), 'backtesting');
    const c = topRaw[i];
    const selection = runParts(selectionParts, base, c.strategyId, c.params).stats;
    const heldOut = runParts(heldOutParts, base, c.strategyId, c.params).stats;
    const gaps = gapsOf(selection, targets);
    top.push({ strategyId: c.strategyId, params: c.params, match: c.match, selection, heldOut, gaps, meetsTargets: gaps.length === 0 });
    await yieldNow();
  }

  const bestMatch = top[0];
  const bestMeetingTargets = top.find((c) => c.meetsTargets) ?? null;
  let closest: Candidate | null = null;
  if (!bestMeetingTargets) {
    let best = Infinity;
    for (const c of top) {
      const size = gapSize(c.gaps);
      if (size < best) {
        best = size;
        closest = c;
      }
    }
  }
  const chosen = bestMeetingTargets ?? closest ?? bestMatch;
  const recommendations = [...top.filter((c) => c.meetsTargets), ...top.filter((c) => !c.meetsTargets)];

  checkAbort();
  report(0.95, 'validating');
  const validation = validateCandidate({
    candidate: chosen,
    sweeps: spaces.get(chosen.strategyId) as SweepParam[],
    targets,
    base,
    fullSeries: series.map((s) => s.candles),
    selection: selectionParts,
    heldOut: heldOutParts,
    valid: (p) => validParams(chosen.strategyId, p),
    checkAbort,
  });
  report(1, 'done');

  return { kind: 'ok', recommendations, bestMatch, bestMeetingTargets, closest, validation, skipped, usedTrades: have, candidates: all.length };
}
