/**
 * The Composed strategy in the market search: for each picked entry rule, that rule's own coarse grid crossed with each
 * picked filter both off and on. The count is worked out without building the settings.
 */
import type { Interval } from '../../../../shared/market.ts';
import { parseInterval } from '../../../../shared/market.ts';
import type { SweepParam } from '../../lib/backtest/optimizer';
import { COMPOSED_DEFAULTS } from '../../lib/backtest/composed';
import { composedEntryKeys } from '../../lib/backtest/strategies';
import { candidatesOf, validParams, type Raw } from '../engine/search';
import type { SweepComposed } from './types';

export const COMPOSED_FILTERS = ['trend', 'volume', 'atr', 'adx'] as const;
export type ComposedFilter = (typeof COMPOSED_FILTERS)[number];
/** The entry rules of Composed (the `entryRule` setting). */
export const COMPOSED_ENTRY_RULES = [1, 2, 3, 4, 5, 6] as const;
/** The trend timeframes, as multiples of the loaded bars. */
export const COMPOSED_TREND_TFS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

const UNIT_SECONDS = { m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 } as const;
const WEEK = 604800;

const range = (key: string, from: number, to: number, step: number): SweepParam => ({ key, from, to, step });

/** Each entry rule's own coarse grid (9 to 12 settings). */
export const ENTRY_GRIDS: Record<number, SweepParam[]> = {
  1: [range('fast', 5, 15, 5), range('slow', 50, 150, 50)],
  2: [range('fast', 5, 15, 5), range('slow', 40, 120, 40)],
  3: [range('fast', 8, 12, 4), range('slow', 21, 31, 5), range('signal', 5, 9, 4)],
  4: [range('length', 7, 21, 7), range('oversold', 25, 30, 5), range('overbought', 70, 75, 5)],
  5: [range('length', 20, 40, 20), range('mult', 1.5, 2.5, 0.5), range('mode', 0, 1, 1)],
  6: [range('entry', 10, 40, 15), range('exit', 5, 15, 5)],
};

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** The picked entry rules, in order, each once. */
export const rulesOf = (c: SweepComposed): number[] => COMPOSED_ENTRY_RULES.filter((r) => c.entryRules.includes(r));
/** The picked filters, in order, each once. */
export const filtersOf = (c: SweepComposed): ComposedFilter[] => COMPOSED_FILTERS.filter((f) => c.filters.includes(f));

/** Seconds in one bar of the timeframe (0 when it cannot be read). */
function barSeconds(timeframe: Interval): number {
  const p = parseInterval(timeframe);
  return p ? p.n * UNIT_SECONDS[p.unit] : 0;
}

/** The trend multiples tried on a timeframe: 1 and the picked ones; on bars of a week or longer a multiple above 1 would run the same as 1. */
export function trendTfsOf(c: SweepComposed, timeframe: Interval): number[] {
  if (barSeconds(timeframe) >= WEEK) return [1];
  const picked = c.trendTfs.filter((k) => (COMPOSED_TREND_TFS as readonly number[]).includes(k));
  return [...uniq([1, ...picked])].sort((a, b) => a - b);
}

/** The settings each filter adds when it is on. */
function onOptions(filter: ComposedFilter, c: SweepComposed, timeframe: Interval): Array<Record<string, number>> {
  switch (filter) {
    case 'trend': {
      const out: Array<Record<string, number>> = [];
      for (const trendFilter of [1, 2]) {
        for (const trendLen of [100, 200]) {
          for (const trendTf of trendTfsOf(c, timeframe)) out.push({ trendFilter, trendLen, trendTf });
        }
      }
      return out;
    }
    case 'volume':
      return [{ volumeFilter: 1, volumeMult: 1.5 }];
    case 'atr':
      return [{ atrFilter: 1, atrLen: COMPOSED_DEFAULTS.atrLen, atrMinPct: COMPOSED_DEFAULTS.atrMinPct, atrMaxPct: COMPOSED_DEFAULTS.atrMaxPct }];
    case 'adx':
      return [{ adxFilter: 1, adxMin: 25 }];
  }
}

/** The valid settings of one entry rule's own grid. */
function entrySettings(rule: number, direction: number): Raw[] {
  const sweeps: SweepParam[] = [{ key: 'entryRule', from: rule, to: rule, step: 1 }, ...ENTRY_GRIDS[rule]];
  return [...candidatesOf('composed', sweeps, direction)];
}

/** How many settings Composed adds on a timeframe, worked out without building them. */
export function composedCount(c: SweepComposed | undefined, timeframe: Interval): number {
  if (!c) return 0;
  const rules = rulesOf(c);
  if (rules.length === 0) return 0;
  let perEntry = 1;
  for (const f of filtersOf(c)) perEntry *= 1 + onOptions(f, c, timeframe).length;
  let n = 0;
  for (const r of rules) n += entrySettings(r, 1).length * perEntry;
  return n;
}

/** The settings Composed adds on a timeframe: every picked rule's grid, crossed with each picked filter off and on. */
export function composedSettings(c: SweepComposed | undefined, timeframe: Interval, direction: number): Raw[] {
  if (!c) return [];
  const rules = rulesOf(c);
  if (rules.length === 0) return [];
  // Each filter: off, then every way of being on.
  const axes = filtersOf(c).map((f) => [{}, ...onOptions(f, c, timeframe)] as Array<Record<string, number>>);
  const out: Raw[] = [];
  for (const r of rules) {
    for (const entry of entrySettings(r, direction)) {
      const idx = axes.map(() => 0);
      for (;;) {
        const params = { ...entry.params };
        axes.forEach((a, i) => Object.assign(params, a[idx[i]]));
        if (validParams('composed', params)) out.push({ strategyId: 'composed', params });
        let a = axes.length - 1;
        while (a >= 0 && ++idx[a] === axes[a].length) idx[a--] = 0;
        if (a < 0) break;
      }
    }
  }
  return out;
}

const ENTRY_NAMES: Record<number, string> = {
  1: 'SMA crossover',
  2: 'EMA crossover',
  3: 'MACD',
  4: 'RSI reversion',
  5: 'Bollinger bands',
  6: 'Donchian breakout',
};
const KEY_WORDS: Record<string, string> = { mult: 'std dev', oversold: 'oversold', overbought: 'overbought' };
const num = (n: number): string => String(Number(n.toFixed(4)));

/**
 * A Composed setting in words: the entry rule's name and its own settings, then only the filters that are on. For example
 * `EMA crossover fast 10, slow 40; trend EMA 200 on 4x bars; ADX 25 or more`.
 */
export function composedWords(p: Record<string, number>): string {
  const rule = Math.round(p.entryRule ?? 2);
  const own = composedEntryKeys(rule).map((k) => `${KEY_WORDS[k] ?? k} ${k === 'mode' ? (p[k] === 1 ? 'reversion' : 'breakout') : num(p[k])}`);
  const parts = [`${ENTRY_NAMES[rule] ?? `rule ${rule}`} ${own.join(', ')}`];
  const d = COMPOSED_DEFAULTS;
  const get = (k: keyof typeof COMPOSED_DEFAULTS): number => (Number.isFinite(p[k]) ? p[k] : d[k]);
  const on = (k: string): boolean => Math.round(p[k] ?? 0) !== 0;
  const tf = (k: number): string => (Math.round(k) > 1 ? ` on ${Math.round(k)}x bars` : '');
  if (on('trendFilter')) parts.push(`trend ${Math.round(p.trendFilter) === 2 ? 'EMA' : 'SMA'} ${num(get('trendLen'))}${tf(get('trendTf'))}`);
  if (on('volumeFilter')) parts.push(`volume ${num(get('volumeMult'))}x its ${num(get('volumeLen'))}-bar average`);
  if (on('atrFilter')) parts.push(`ATR ${num(get('atrMinPct'))} to ${num(get('atrMaxPct'))}% of close${tf(get('atrTf'))}`);
  if (on('adxFilter')) parts.push(`ADX ${num(get('adxMin'))} or more`);
  return parts.join('; ');
}
