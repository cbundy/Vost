import { describe, expect, it } from 'vitest';
import type { MarketList, MarketListEntry } from '../../../shared/marketLists.ts';
import { DEFAULT_SWEEP_INPUT, MAX_SWEEP_COMBOS } from './sweep/sweep';
import { defaultSweepForm, marketsOf, planSweep, readSweepForm } from './sweepForm';

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

  it('can run once a list is picked', () => {
    expect(planSweep(picked(), lists).blocker).toBeNull();
  });

  it('blocks with a reason for no list, no timeframe, no family, no target row', () => {
    expect(planSweep(defaultSweepForm(), lists).blocker).toMatch(/market list/);
    expect(planSweep(picked({ timeframes: [] }), lists).blocker).toMatch(/timeframe/);
    expect(planSweep(picked({ families: [] }), lists).blocker).toMatch(/indicator/);
    expect(planSweep(picked({ targets: [{ hit: '', rr: '' }, { hit: '', rr: '' }] }), lists).blocker).toMatch(/target row/);
    expect(planSweep(picked({ stopMults: [] }), lists).blocker).toMatch(/stop/);
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
