/**
 * The TradingView indicators of the market search: each stored indicator is an entry rule or a filter of Composed, and
 * chosen number inputs are stepped over ranges. An input setting is one combination of the range values, laid over the
 * role's fixed inputs. Counts are worked out without building the settings.
 */
import { MAX_FILTER_ROLES, parsePineRole, type PineRole } from '../../lib/backtest/pineRole';
import type { ExitGrid, SweepComposed, SweepInput, SweepPineRange, SweepPineRole } from './types';

/** Most script runs one search may need (each distinct indicator and input setting, on each part of each market and timeframe). */
export const MAX_PINE_RUNS = 2_000;
/** Most TradingView indicator entry rules in one search. */
export const MAX_PINE_ENTRIES = 4;

const MAX_RANGE_NAME = 200;

/** How many values a range steps through (its ends included). The range must pass `checkRange`. */
export const rangeCount = (r: SweepPineRange): number => Math.floor((r.to - r.from) / r.step + 1e-9) + 1;

/** The values of a range, rounded as the other searches round theirs. */
function rangeValues(r: SweepPineRange): number[] {
  const out: number[] = [];
  for (let i = 0, n = rangeCount(r); i < n; i++) out.push(Math.round((r.from + i * r.step) * 1e6) / 1e6);
  return out;
}

/** How many input settings a role has: the product of its ranges' value counts, 1 with no range. */
export function inputSettingCount(p: SweepPineRole): number {
  let n = 1;
  for (const r of p.ranges) n *= rangeCount(r);
  return n;
}

/** The range values of each input setting of a role, the first range varying slowest. One empty setting when the role has no range. */
export function inputSettingsOf(p: SweepPineRole): Array<Record<string, number>> {
  let out: Array<Record<string, number>> = [{}];
  for (const r of p.ranges) {
    const values = rangeValues(r);
    out = out.flatMap((o) => values.map((v) => ({ ...o, [r.input]: v })));
  }
  return out;
}

/** The roles of a search entry, one per input setting: the fixed inputs with the range values laid over them, and no source. */
export function rolesOfPine(p: SweepPineRole): PineRole[] {
  const { source: _drop, ...role } = p.role as PineRole;
  return inputSettingsOf(p).map((s) => ({ ...role, inputs: { ...role.inputs, ...s } }));
}

/** The key of one script run: the indicator and its input values (the order of the inputs does not matter). */
export const runKeyOf = (role: Pick<PineRole, 'indicatorId' | 'inputs'>): string =>
  JSON.stringify([role.indicatorId, Object.entries(role.inputs).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))]);

export const pineEntries = (c: SweepComposed | undefined): SweepPineRole[] => (c?.pine ?? []).filter((p) => p.role.role === 'entry');
export const pineFilters = (c: SweepComposed | undefined): SweepPineRole[] => (c?.pine ?? []).filter((p) => p.role.role === 'filter');

const named = (p: SweepPineRole): string => `"${p.role.name}"`;

function checkRange(p: SweepPineRole, r: SweepPineRange): void {
  const where = `${named(p)} input "${r.input}"`;
  if (typeof r.input !== 'string' || r.input === '' || r.input.length > MAX_RANGE_NAME) throw new Error(`A range of the TradingView indicator ${named(p)} has no input name.`);
  for (const k of ['from', 'to', 'step'] as const) {
    if (typeof r[k] !== 'number' || !Number.isFinite(r[k])) throw new Error(`The range of ${where} needs a number for ${k}.`);
  }
  if (!(r.step > 0)) throw new Error(`The range of ${where} needs a step above 0.`);
  if (r.from > r.to) throw new Error(`The range of ${where} starts above where it ends.`);
  const fixed = p.role.inputs[r.input];
  if (fixed !== undefined && typeof fixed !== 'number') throw new Error(`${where} is not a number input, so it cannot be searched over a range.`);
  if (r.int && ![r.from, r.to, r.step].every(Number.isInteger)) throw new Error(`The range of ${where} must use whole numbers.`);
  if (r.min !== undefined && r.from < r.min) throw new Error(`The range of ${where} starts below the input's minimum of ${r.min}.`);
  if (r.max !== undefined && r.to > r.max) throw new Error(`The range of ${where} ends above the input's maximum of ${r.max}.`);
  if (rangeCount(r) > MAX_PINE_RUNS) throw new Error(`The range of ${where} has more than ${MAX_PINE_RUNS} values; the limit on script runs is ${MAX_PINE_RUNS}. Use a larger step.`);
}

/** Refuses what the search cannot take, with a plain message. */
export function checkPine(c: SweepComposed): void {
  if (c.pine === undefined) return;
  if (!Array.isArray(c.pine)) throw new Error('The TradingView indicators of the search are malformed.');
  for (const p of c.pine) {
    const parsed = p && typeof p === 'object' ? parsePineRole(p.role) : null;
    if (!parsed) throw new Error(`A TradingView indicator in the search is malformed${p?.role && typeof p.role.name === 'string' ? ` (${p.role.name})` : ''}.`);
    if (!Array.isArray(p.ranges)) throw new Error(`The ranges of the TradingView indicator ${named(p)} are malformed.`);
    const seen = new Set<string>();
    for (const r of p.ranges) {
      checkRange(p, r);
      if (seen.has(r.input)) throw new Error(`The TradingView indicator ${named(p)} has two ranges for input "${r.input}".`);
      seen.add(r.input);
    }
  }
  if (pineEntries(c).length > MAX_PINE_ENTRIES) throw new Error(`The search takes at most ${MAX_PINE_ENTRIES} TradingView indicator entry rules.`);
  if (pineFilters(c).length > MAX_FILTER_ROLES) throw new Error(`The search takes at most ${MAX_FILTER_ROLES} TradingView indicator filters.`);
}

/** Refuses a `'pine'` exit kind without a valid stop role (a stop with a plot). A stop without the kind is ignored. */
export function checkPineStop(g: ExitGrid): void {
  if (!(g.kinds ?? []).includes('pine')) return;
  const role = g.pineStop && typeof g.pineStop === 'object' ? parsePineRole(g.pineStop) : null;
  if (!role || role.role !== 'stop') throw new Error('The TradingView indicator stop needs a stored indicator stop with a plot picked.');
}

/** Whether the grid asks for the TradingView indicator stop and names one. */
export const pineStopOn = (g: ExitGrid): g is ExitGrid & { pineStop: Omit<PineRole, 'source'> } => (g.kinds ?? []).includes('pine') && !!g.pineStop;

/** Whether some setting of Composed is built (an entry rule is picked). */
const composedBuilt = (c: SweepComposed | undefined): boolean => !!c && (c.entryRules.length > 0 || pineEntries(c).length > 0);

/**
 * Script runs a search needs: markets x timeframes x the distinct (indicator, input setting) pairs x the two parts, twice
 * with the baseline. An indicator used as an entry and as a filter with the same inputs counts once. The stop of the TradingView
 * indicator exit counts once too. Zero when Composed has
 * no entry rule (no setting is built, so no script runs).
 */
export function pineRunCount(input: SweepInput): number {
  const c = input.composed;
  const stop = pineStopOn(input.exits);
  if (!composedBuilt(c) || (!c?.pine?.length && !stop)) return 0;
  // A role with more settings than the limit is over it on its own: nothing is built.
  if (c?.pine?.some((p) => inputSettingCount(p) > MAX_PINE_RUNS)) return Infinity;
  const distinct = new Set<string>();
  if (stop) distinct.add(runKeyOf(input.exits.pineStop as Omit<PineRole, 'source'>));
  for (const p of c?.pine ?? []) for (const r of rolesOfPine(p)) distinct.add(runKeyOf(r));
  return input.markets.length * input.timeframes.length * distinct.size * 2 * (input.baseline ? 2 : 1);
}
