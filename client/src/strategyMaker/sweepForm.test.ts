import { describe, expect, it } from 'vitest';
import type { MarketList, MarketListEntry } from '../../../shared/marketLists.ts';
import { DEFAULT_SWEEP_INPUT, MAX_SWEEP_COMBOS } from './sweep/sweep';
import { composedCount } from './sweep/composedSpace';
import { sweepCombos } from './sweep/sweep';
import type { SweepPineRole } from './sweep/types';
import { defaultSweepForm, EXIT_KIND_OPTIONS, marketsOf, planSweep, readSweepForm, SWEEP_FAMILIES, SWEEP_FAMILY_NOTES, SWEEP_TIMEFRAME_NOTES, SWEEP_TIMEFRAMES } from './sweepForm';

const entry = (symbol: string, provider: 'binance' | 'yahoo' = 'binance'): MarketListEntry => ({ provider, symbol, name: symbol, rank: 1 });
const list = (id: string, symbols: string[], over: Partial<MarketList> = {}): MarketList => ({
  id: id as MarketList['id'],
  title: id,
  source: 'test',
  date: '2026-11-05',
  live: false,
  entries: symbols.map((s) => entry(s)),
  excluded: [],
  skipped: [],
  ...over,
});
const lists = [list('crypto-cap', ['BTCUSDT', 'ETHUSDT']), list('crypto-volume', ['ETHUSDT', 'SOLUSDT'])];
const picked = (over: Partial<ReturnType<typeof defaultSweepForm>> = {}) => ({ ...defaultSweepForm(), listIds: ['crypto-cap'], ...over });

describe('search form', () => {
  it('starts as the default example search, with no list picked', () => {
    const f = defaultSweepForm();
    expect(f.listIds).toEqual([]);
    const { input, errors } = readSweepForm(f);
    expect(errors).toEqual({});
    expect(input).toEqual(DEFAULT_SWEEP_INPUT);
    expect(input.targetSets).toEqual([
      { minHitRatePct: 75, minRR: 1 },
      { minHitRatePct: 50, minRR: 4 },
    ]);
    expect(input.risk).toMatchObject({ initialCapital: 1000, riskPct: 2 });
  });

  it('gives each bad number its message and blocks with the reason', () => {
    const f = picked({ capital: 'x', riskPct: '0', feeBps: '-1', slippageBps: '' });
    f.targets = [{ hit: '101', rr: 'abc' }, { hit: '50', rr: '4' }];
    const plan = planSweep(f, lists);
    expect(Object.keys(plan.errors).sort()).toEqual(['capital', 'feeBps', 'hit0', 'riskPct', 'rr0', 'slippageBps']);
    expect(plan.blocker).toBe('Fix the numbers marked above.');
  });

  it('starts with the range kind only, and every kind chosen triples the count', () => {
    expect(defaultSweepForm().exitKinds).toEqual(['range']);
    const one = planSweep(picked(), lists).combos;
    expect(planSweep(picked({ exitKinds: ['range', 'atr', 'atr_trail'] }), lists).combos).toBe(one * 3);
  });

  it('can run once a list is picked', () => {
    expect(planSweep(picked(), lists).blocker).toBeNull();
  });

  it('blocks with a reason for no list, no timeframe, no family, no target row', () => {
    expect(planSweep(defaultSweepForm(), lists).blocker).toMatch(/market list/);
    expect(planSweep(picked({ timeframes: [] }), lists).blocker).toMatch(/timeframe/);
    expect(planSweep(picked({ families: [] }), lists).blocker).toMatch(/indicator/);
    expect(planSweep(picked({ targets: [{ hit: '', rr: '' }, { hit: '', rr: '' }] }), lists).blocker).toMatch(/target row/);
    expect(planSweep(picked({ stopMults: [] }), lists).blocker).toMatch(/stop/);
    expect(planSweep(picked({ exitKinds: [] }), lists).blocker).toBe('Pick at least one exit kind.');
  });

  it('a list with an error cannot count', () => {
    const bad = list('stocks-cap', [], { error: 'upstream down' });
    expect(planSweep(picked({ listIds: ['stocks-cap'] }), [bad]).blocker).toMatch(/no markets/);
  });

  it('a cleared second row leaves one target set', () => {
    const f = picked();
    f.targets = [f.targets[0], { hit: '', rr: '' }];
    const plan = planSweep(f, lists);
    expect(plan.input.targetSets).toEqual([{ minHitRatePct: 75, minRR: 1 }]);
    expect(plan.blocker).toBeNull();
  });

  it('counts a market in two lists once', () => {
    const both = picked({ listIds: ['crypto-cap', 'crypto-volume'] });
    expect(marketsOf(lists, both.listIds).map((m) => m.symbol)).toEqual(['BTCUSDT', 'ETHUSDT', 'SOLUSDT']);
    const one = planSweep(picked({ timeframes: ['1d'] }), [lists[0]]);
    const three = planSweep({ ...both, timeframes: ['1d'] }, lists);
    expect(three.combos).toBe((one.combos / 2) * 3);
    // the same symbol on another provider is another market
    const mixed = [list('a', ['X']), list('b', [], { entries: [entry('X', 'yahoo')] })];
    expect(marketsOf(mixed, ['a', 'b'])).toHaveLength(2);
  });

  it('blocks a search over the combination limit and says the limit', () => {
    const symbols = Array.from({ length: 5000 }, (_, i) => `S${i}`);
    const f = picked({ families: ['macd_cross', 'sma_cross', 'ema_cross', 'rsi_reversion', 'bollinger', 'donchian'], timeframes: ['1d', '1w', '1h', '4h'] });
    const plan = planSweep(f, [list('crypto-cap', symbols)]);
    expect(plan.combos).toBeGreaterThan(MAX_SWEEP_COMBOS);
    expect(plan.blocker).toContain('2,000,000');
  });
});

describe('search form: Composed, buy and hold, baseline and study notes', () => {
  it('keeps the defaults: Composed off, baseline off, buy and hold off, 1d and 1w, MACD, SMA and EMA', () => {
    const f = defaultSweepForm();
    expect([f.composedOn, f.baseline, f.beatBuyHold]).toEqual([false, false, 'off']);
    expect(f.timeframes).toEqual(['1d', '1w']);
    expect(f.families).toEqual(['macd_cross', 'sma_cross', 'ema_cross']);
    const { input } = readSweepForm(f);
    expect(input).not.toHaveProperty('composed');
    expect(input).not.toHaveProperty('beatBuyHold');
    expect(input).not.toHaveProperty('baseline');
  });

  it('reads the new fields into the input', () => {
    const { input } = readSweepForm({
      ...defaultSweepForm(),
      composedOn: true,
      composedRules: [3, 1],
      composedFilters: ['adx', 'trend'],
      composedTrendTfs: [4, 2],
      beatBuyHold: 'return_dd',
      baseline: true,
    });
    expect(input.composed).toEqual({ entryRules: [1, 3], filters: ['trend', 'adx'], trendTfs: [4, 2] });
    expect(input.beatBuyHold).toBe('return_dd');
    expect(input.baseline).toBe(true);
  });

  it('blocks Composed with no entry rule, and lets Composed stand in for the indicators', () => {
    expect(planSweep(picked({ composedOn: true, composedRules: [] }), lists).blocker).toBe('Pick at least one Composed entry rule.');
    expect(planSweep(picked({ families: [], composedOn: true, composedRules: [2] }), lists).blocker).toBeNull();
    expect(planSweep(picked({ families: [] }), lists).blocker).toMatch(/indicator/);
  });

  it('counts Composed and the baseline as the search does', () => {
    const plain = planSweep(picked(), lists).combos;
    const withC = planSweep(picked({ composedOn: true }), lists);
    expect(withC.combos).toBeGreaterThan(plain);
    expect(withC.combos).toBe(sweepCombos(withC.input));
    const markets = withC.input.markets.length;
    expect(withC.combos).toBe(plain + markets * (composedCount(withC.input.composed, '1d') + composedCount(withC.input.composed, '1w')) * 18);
    expect(planSweep(picked({ composedOn: true, baseline: true }), lists).combos).toBe(2 * withC.combos);
  });

  it('offers 1m and 5m and attaches the study notes to 1m to 30m, RSI reversion and Bollinger', () => {
    expect(SWEEP_TIMEFRAMES.slice(0, 2)).toEqual(['1m', '5m']);
    expect(Object.keys(SWEEP_TIMEFRAME_NOTES).sort()).toEqual(['15m', '1m', '30m', '5m']);
    expect(SWEEP_TIMEFRAME_NOTES['1m']).toBe('nothing met a target on these bars in the study');
    expect(Object.keys(SWEEP_FAMILY_NOTES).sort()).toEqual(['bollinger', 'rsi_reversion']);
    expect(SWEEP_FAMILY_NOTES.bollinger).toBe('expect little: nothing held in the study');
    expect(SWEEP_FAMILIES.map((f) => f.id)).toEqual(expect.arrayContaining(['rsi_reversion', 'bollinger']));
  });
});

describe('search form with TradingView indicators', () => {
  const role = (over: Partial<SweepPineRole['role']> = {}, ranges: SweepPineRole['ranges'] = []): SweepPineRole => ({
    role: { indicatorId: 'ema', name: 'My EMA', inputs: {}, role: 'entry', rule: { type: 'cross', a: { kind: 'close' }, b: { kind: 'plot', plot: 'EMA' } }, ...over },
    ranges,
  });
  const withPine = (pine: SweepPineRole[], over: Partial<ReturnType<typeof defaultSweepForm>> = {}) =>
    picked({ composedOn: true, composedRules: [], composedFilters: [], families: [], composedPine: pine, ...over });

  it('puts the picked indicators in the Composed input, and none when none is picked', () => {
    const pine = [role({}, [{ input: 'Length', from: 10, to: 30, step: 10 }])];
    expect(readSweepForm(withPine(pine)).input.composed?.pine).toEqual(pine);
    expect(readSweepForm(picked({ composedOn: true })).input.composed).not.toHaveProperty('pine');
    expect(readSweepForm(withPine(pine, { composedOn: false })).input).not.toHaveProperty('composed');
  });

  it('a form with only Pine entries can run, and with nothing to enter on it cannot', () => {
    expect(planSweep(withPine([role()]), lists).blocker).toBeNull();
    expect(planSweep(withPine([role({ role: 'filter', rule: { type: 'above', a: { kind: 'close' }, b: { kind: 'plot', plot: 'EMA' } } })]), lists).blocker).toMatch(/entry rule/);
  });

  it('plan reports the script-run count and the combination count with the Pine settings', () => {
    const plan = planSweep(withPine([role({}, [{ input: 'Length', from: 10, to: 30, step: 10 }])]), lists);
    // 2 markets x 2 timeframes (1d, 1w) x 3 input settings x 2 parts.
    expect(plan.pineRuns).toBe(2 * 2 * 3 * 2);
    expect(plan.combos).toBe(sweepCombos(plan.input));
    expect(plan.combos).toBeGreaterThan(0);
    expect(planSweep(picked(), lists).pineRuns).toBe(0);
  });

  it('is blocked above the script-run limit with its own text, and the count shows', () => {
    const plan = planSweep(withPine([role({}, [{ input: 'Length', from: 2, to: 600, step: 1 }])]), lists);
    expect(plan.pineRuns).toBe(2 * 2 * 599 * 2);
    expect(plan.blocker).toMatch(/4,792 TradingView script runs; the limit is 2,000/);
    expect(plan.combos).toBeLessThan(MAX_SWEEP_COMBOS);
  });

  it('is blocked, with the reason, when a range is not valid; the counts stay finite', () => {
    const plan = planSweep(withPine([role({}, [{ input: 'Length', from: 10, to: 30, step: 0 }])]), lists);
    expect(plan.blocker).toMatch(/step above 0/);
    expect(Number.isFinite(plan.combos)).toBe(true);
    expect(plan.pineRuns).toBe(0);
  });
});

describe('search form: the TradingView indicator stop', () => {
  const stop = { indicatorId: 'st', name: 'Supertrend', inputs: {}, role: 'stop' as const, mode: 'trailing' as const, rule: { type: 'level' as const, plot: 'Supertrend' } };
  const composedPicked = (over: Partial<ReturnType<typeof defaultSweepForm>> = {}) => picked({ composedOn: true, composedRules: [2], composedFilters: [], composedTrendTfs: [], ...over });

  it('is offered as an exit kind and starts with no stop picked', () => {
    expect(defaultSweepForm().pineStop).toBeNull();
    expect(EXIT_KIND_OPTIONS.map((o) => o.id)).toEqual(['range', 'atr', 'atr_trail', 'pine']);
  });

  it('blocks Run without a plot picked, and without Composed', () => {
    expect(planSweep(composedPicked({ exitKinds: ['range', 'pine'] }), lists).blocker).toMatch(/stop with a plot/);
    expect(planSweep(picked({ exitKinds: ['range', 'pine'], pineStop: stop }), lists).blocker).toMatch(/Composed only/);
    expect(planSweep(composedPicked({ exitKinds: ['range', 'pine'], pineStop: stop }), lists).blocker).toBeNull();
    expect(planSweep(composedPicked({ exitKinds: ['range', 'pine'], pineStop: { ...stop, rule: { type: 'level', plot: '' } } }), lists).blocker).toMatch(/stop with a plot/);
  });

  it('adds the exits and the script runs to the plan, and ignores a stop without the kind', () => {
    const without = planSweep(composedPicked(), lists);
    expect(planSweep(composedPicked({ pineStop: stop }), lists)).toMatchObject({ combos: without.combos, pineRuns: 0 });
    const plan = planSweep(composedPicked({ exitKinds: ['range', 'pine'], pineStop: stop }), lists);
    expect(plan.combos).toBe(sweepCombos(plan.input));
    expect(plan.combos).toBeGreaterThan(without.combos);
    expect(plan.pineRuns).toBe(2 * plan.input.timeframes.length * 2);
    expect(plan.input.exits.pineStop).toEqual(stop);
  });

  it('with only this kind, the stop multiples are not needed', () => {
    expect(planSweep(composedPicked({ exitKinds: ['pine'], pineStop: stop, stopMults: [] }), lists).blocker).toBeNull();
    expect(planSweep(composedPicked({ exitKinds: ['range', 'pine'], pineStop: stop, stopMults: [] }), lists).blocker).toMatch(/stop and one take-profit/);
  });
});
