/** The Search markets form: its defaults, its numbers read with a message for each bad one, the markets of the chosen lists, and what Run needs. */
import type { Interval } from '../../../shared/market.ts';
import type { MarketList } from '../../../shared/marketLists.ts';
import type { SearchDirection } from './engine/types';
import { num } from './form';
import { DEFAULT_SWEEP_INPUT, MAX_SWEEP_COMBOS, sweepCombos } from './sweep/sweep';
import { COMPOSED_ENTRY_RULES, COMPOSED_FILTERS, COMPOSED_TREND_TFS, type ComposedFilter } from './sweep/composedSpace';
import type { BeatBuyHold, ExitKind, SweepInput, SweepMarket, TargetSet } from './sweep/types';

/** Timeframes both the Binance and the Yahoo provider serve. */
export const SWEEP_TIMEFRAMES: Interval[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'];
/** Where the study behind these notes is explained. */
export const SEARCH_GUIDE_URL = 'https://github.com/cbundy/Vost/blob/main/docs/guide/strategy-maker.md#searching-many-markets';
/** A note on a timeframe the study found empty. It stays pickable. */
export const SWEEP_TIMEFRAME_NOTES: Partial<Record<Interval, string>> = Object.fromEntries(
  (['1m', '5m', '15m', '30m'] as Interval[]).map((tf) => [tf, 'nothing met a target on these bars in the study']),
);
/** A note on an indicator the study found empty. It stays pickable. */
export const SWEEP_FAMILY_NOTES: Record<string, string> = {
  rsi_reversion: 'expect little: nothing held in the study',
  bollinger: 'expect little: nothing held in the study',
};
/** The signal families the market search can use. */
export const SWEEP_FAMILIES: Array<{ id: string; name: string }> = [
  { id: 'macd_cross', name: 'MACD crossover' },
  { id: 'sma_cross', name: 'SMA crossover' },
  { id: 'ema_cross', name: 'EMA crossover' },
  { id: 'rsi_reversion', name: 'RSI reversion' },
  { id: 'bollinger', name: 'Bollinger bands' },
  { id: 'donchian', name: 'Donchian breakout' },
];
/** The Composed entry rules offered, with their names. */
export const COMPOSED_RULE_OPTIONS: Array<{ id: number; label: string }> = [
  { id: 1, label: 'SMA crossover' },
  { id: 2, label: 'EMA crossover' },
  { id: 3, label: 'MACD' },
  { id: 4, label: 'RSI mean reversion' },
  { id: 5, label: 'Bollinger Bands' },
  { id: 6, label: 'Donchian breakout' },
];
/** The Composed filters offered, with their labels. */
export const COMPOSED_FILTER_OPTIONS: Array<{ id: ComposedFilter; label: string }> = [
  { id: 'trend', label: 'Trend (price vs SMA or EMA)' },
  { id: 'volume', label: 'Volume' },
  { id: 'atr', label: 'Volatility (ATR band)' },
  { id: 'adx', label: 'Trend strength (ADX)' },
];
/** The trend timeframes offered, as multiples of the loaded bars (1 is always tried). */
export const COMPOSED_TREND_TF_OPTIONS: number[] = COMPOSED_TREND_TFS.filter((k) => k > 1);
/** The unseen-data targets offered. */
export const BEAT_BUY_HOLD_OPTIONS: Array<{ id: BeatBuyHold; label: string }> = [
  { id: 'off', label: 'No target' },
  { id: 'return', label: 'Return above buy and hold' },
  { id: 'return_dd', label: 'Return over drawdown above buy and hold' },
];
/** The multiples offered for stops (times the typical bar range) and for take profits (times the stop). */
export const STOP_MULT_OPTIONS = [0.5, 1, 2, 3, 4, 6];
export const TP_MULT_OPTIONS = [0.5, 1, 1.5, 2, 3, 4, 5];
/** The exit kinds offered, with their labels. */
export const EXIT_KIND_OPTIONS: Array<{ id: ExitKind; label: string }> = [
  { id: 'range', label: 'Stop sized by the typical bar range' },
  { id: 'atr', label: 'ATR stop' },
  { id: 'atr_trail', label: 'ATR trailing stop' },
];
/** Rows of "hit rate / R:R" targets the form shows. */
export const TARGET_ROWS = 2;

export interface TargetRow {
  hit: string;
  rr: string;
}

export interface SweepForm {
  /** Ids of the market lists picked. */
  listIds: string[];
  timeframes: Interval[];
  families: string[];
  direction: SearchDirection;
  targets: TargetRow[];
  capital: string;
  riskPct: string;
  feeBps: string;
  slippageBps: string;
  stopMults: number[];
  tpMults: number[];
  exitKinds: ExitKind[];
  /** Composed (entry + filters) on, and its picks. */
  composedOn: boolean;
  composedRules: number[];
  composedFilters: ComposedFilter[];
  /** Trend timeframes beyond the loaded bars. */
  composedTrendTfs: number[];
  beatBuyHold: BeatBuyHold;
  baseline: boolean;
}

export function defaultSweepForm(): SweepForm {
  const d = DEFAULT_SWEEP_INPUT;
  return {
    listIds: [],
    timeframes: [...d.timeframes],
    families: [...d.families],
    direction: d.direction,
    targets: d.targetSets.map((t) => ({ hit: String(t.minHitRatePct ?? ''), rr: String(t.minRR ?? '') })),
    capital: String(d.risk.initialCapital),
    riskPct: String(d.risk.riskPct),
    feeBps: String(d.risk.feeBps),
    slippageBps: String(d.risk.slippageBps),
    stopMults: [...d.exits.stopMults],
    tpMults: [...d.exits.tpMults],
    exitKinds: [...(d.exits.kinds ?? ['range'])],
    composedOn: false,
    composedRules: [2],
    composedFilters: ['trend'],
    composedTrendTfs: [4],
    beatBuyHold: 'off',
    baseline: false,
  };
}

/** Keys of the fields that carry an error: the numbers and the target cells (`hit0`, `rr0`, `hit1`, ...). */
export type SweepErrors = Record<string, string>;

export function readSweepForm(f: SweepForm): { input: Omit<SweepInput, 'markets'>; errors: SweepErrors } {
  const errors: SweepErrors = {};
  const get = (k: string, n: ReturnType<typeof num>): number => {
    if (n.error) errors[k] = n.error;
    return n.value ?? 0;
  };
  const initialCapital = get('capital', num(f.capital, 'Account size', 1, 1e12, false));
  const riskPct = get('riskPct', num(f.riskPct, 'Risk per trade', 0, 100, false, true));
  const feeBps = get('feeBps', num(f.feeBps, 'Fee', 0, 1000, false));
  const slippageBps = get('slippageBps', num(f.slippageBps, 'Slippage', 0, 1000, false));
  const targetSets: TargetSet[] = [];
  f.targets.forEach((row, i) => {
    if (row.hit.trim() === '' && row.rr.trim() === '') return; // a cleared row is left out
    const hit = num(row.hit, 'Min hit rate', 0, 100, true, true);
    const rr = num(row.rr, 'Min R:R', 0, 1000, true, true);
    if (hit.error) errors[`hit${i}`] = hit.error;
    if (rr.error) errors[`rr${i}`] = rr.error;
    const set: TargetSet = {};
    if (hit.value != null) set.minHitRatePct = hit.value;
    if (rr.value != null) set.minRR = rr.value;
    targetSets.push(set);
  });
  return {
    errors,
    input: {
      timeframes: f.timeframes,
      families: f.families,
      direction: f.direction,
      targetSets,
      risk: { initialCapital, riskPct, feeBps, slippageBps },
      exits: { stopMults: f.stopMults, tpMults: f.tpMults, kinds: f.exitKinds },
      ...(f.composedOn
        ? {
            composed: {
              entryRules: COMPOSED_ENTRY_RULES.filter((r) => f.composedRules.includes(r)),
              filters: COMPOSED_FILTERS.filter((x) => f.composedFilters.includes(x)),
              trendTfs: f.composedTrendTfs,
            },
          }
        : {}),
      ...(f.beatBuyHold !== 'off' ? { beatBuyHold: f.beatBuyHold } : {}),
      ...(f.baseline ? { baseline: true } : {}),
    },
  };
}

/** The markets of the picked lists (a list with an error counts for none), each once, keyed by provider and symbol. */
export function marketsOf(lists: MarketList[], listIds: string[]): SweepMarket[] {
  const seen = new Set<string>();
  const out: SweepMarket[] = [];
  for (const l of lists) {
    if (!listIds.includes(l.id) || l.error) continue;
    for (const e of l.entries) {
      const key = `${e.provider}|${e.symbol}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ provider: e.provider, symbol: e.symbol });
    }
  }
  return out;
}

export interface SweepPlan {
  input: SweepInput;
  errors: SweepErrors;
  combos: number;
  /** Why Run is off, or null when it can run. */
  blocker: string | null;
}

export const sweepBlocker = (errors: SweepErrors, f: SweepForm, markets: SweepMarket[], input: SweepInput, combos: number): string | null => {
  if (Object.keys(errors).length) return 'Fix the numbers marked above.';
  if (f.listIds.length === 0) return 'Pick at least one market list.';
  if (markets.length === 0) return 'The lists you picked have no markets.';
  if (f.timeframes.length === 0) return 'Pick at least one timeframe.';
  if (f.composedOn && f.composedRules.length === 0) return 'Pick at least one Composed entry rule.';
  if (f.families.length === 0 && !f.composedOn) return 'Pick at least one indicator family.';
  if (input.targetSets.length === 0) return 'Give at least one target row.';
  if (f.exitKinds.length === 0) return 'Pick at least one exit kind.';
  if (f.stopMults.length === 0 || f.tpMults.length === 0) return 'Pick at least one stop and one take-profit multiple.';
  if (combos > MAX_SWEEP_COMBOS) {
    return `That is ${combos.toLocaleString('en-US')} combinations; the limit is ${MAX_SWEEP_COMBOS.toLocaleString('en-US')}. Pick fewer markets, timeframes or indicators.`;
  }
  return null;
};

/** Everything the panel shows and Run needs for the form as it stands. */
export function planSweep(f: SweepForm, lists: MarketList[]): SweepPlan {
  const { input: rest, errors } = readSweepForm(f);
  const markets = marketsOf(lists, f.listIds);
  const input: SweepInput = { ...rest, markets };
  const combos = sweepCombos(input);
  return { input, errors, combos, blocker: sweepBlocker(errors, f, markets, input, combos) };
}
