import { describe, expect, it } from 'vitest';
import { checkPine, inputSettingCount, inputSettingsOf, MAX_PINE_RUNS, pineRunCount, rolesOfPine, runKeyOf } from './pineSpace';
import type { SweepComposed, SweepInput, SweepPineRole } from './types';

const cross = { type: 'cross', a: { kind: 'close' }, b: { kind: 'plot', plot: 'EMA' } } as const;
const above = { type: 'above', a: { kind: 'close' }, b: { kind: 'plot', plot: 'EMA' } } as const;
const entry = (over: Partial<SweepPineRole['role']> = {}, ranges: SweepPineRole['ranges'] = []): SweepPineRole => ({
  role: { indicatorId: 'ema', name: 'My EMA', inputs: {}, role: 'entry', rule: cross, ...over },
  ranges,
});
const filter = (over: Partial<SweepPineRole['role']> = {}, ranges: SweepPineRole['ranges'] = []): SweepPineRole => ({
  role: { indicatorId: 'ema', name: 'My EMA', inputs: {}, role: 'filter', label: 'trend', rule: above, ...over },
  ranges,
});
const len = (from: number, to: number, step: number, extra: object = {}) => ({ input: 'Length', from, to, step, ...extra });
const composed = (pine: SweepPineRole[], more: Partial<SweepComposed> = {}): SweepComposed => ({ entryRules: [], filters: [], trendTfs: [], pine, ...more });
const input = (c: SweepComposed, over: Partial<SweepInput> = {}): SweepInput => ({
  markets: [
    { provider: 'p', symbol: 'A' },
    { provider: 'p', symbol: 'B' },
  ],
  timeframes: ['1d', '1w'],
  families: [],
  direction: 'long',
  targetSets: [{ minHitRatePct: 0 }],
  risk: { initialCapital: 1000, riskPct: 2, feeBps: 0, slippageBps: 0 },
  exits: { stopMults: [1], tpMults: [1] },
  composed: c,
  ...over,
});

describe('input settings', () => {
  it('cross the ranges exactly, the first varying slowest', () => {
    const p = entry({}, [len(10, 30, 10), { input: 'Mult', from: 1, to: 1.5, step: 0.5 }]);
    expect(inputSettingCount(p)).toBe(6);
    expect(inputSettingsOf(p)).toEqual([
      { Length: 10, Mult: 1 }, { Length: 10, Mult: 1.5 },
      { Length: 20, Mult: 1 }, { Length: 20, Mult: 1.5 },
      { Length: 30, Mult: 1 }, { Length: 30, Mult: 1.5 },
    ]);
  });

  it('a role without a range has one setting, its fixed inputs', () => {
    const p = entry({ inputs: { Source: 'close', Length: 9 } });
    expect(inputSettingsOf(p)).toEqual([{}]);
    expect(rolesOfPine(p).map((r) => r.inputs)).toEqual([{ Source: 'close', Length: 9 }]);
  });

  it('the range values lie over the fixed inputs, and the roles carry no source', () => {
    const p = entry({ inputs: { Length: 1, Other: 5 }, source: 'secret' } as never, [len(20, 40, 10)]);
    const roles = rolesOfPine(p);
    expect(roles.map((r) => r.inputs)).toEqual([{ Length: 20, Other: 5 }, { Length: 30, Other: 5 }, { Length: 40, Other: 5 }]);
    expect(JSON.stringify(roles)).not.toContain('secret');
  });

  it('float steps do not drift', () => {
    expect(inputSettingsOf(entry({}, [len(0.1, 0.4, 0.1)])).map((s) => s.Length)).toEqual([0.1, 0.2, 0.3, 0.4]);
  });
});

describe('checkPine', () => {
  const refuses = (c: SweepComposed, text: RegExp) => expect(() => checkPine(c)).toThrow(text);

  it('accepts a good search and none at all', () => {
    expect(() => checkPine(composed([entry({}, [len(5, 50, 5, { min: 1, max: 100, int: true })]), filter()]))).not.toThrow();
    expect(() => checkPine({ entryRules: [2], filters: [], trendTfs: [] })).not.toThrow();
  });

  it('refuses a step of 0 or less, a backwards range, and a value that is not a number', () => {
    refuses(composed([entry({}, [len(1, 5, 0)])]), /step above 0/);
    refuses(composed([entry({}, [len(1, 5, -1)])]), /step above 0/);
    refuses(composed([entry({}, [len(5, 1, 1)])]), /starts above/);
    refuses(composed([entry({}, [len(Number.NaN, 5, 1)])]), /needs a number/);
  });

  it('refuses a range outside the input\'s bounds, and fractions on a whole-number input', () => {
    refuses(composed([entry({}, [len(0, 5, 1, { min: 1 })])]), /minimum of 1/);
    refuses(composed([entry({}, [len(1, 500, 1, { max: 200 })])]), /maximum of 200/);
    refuses(composed([entry({}, [len(1, 5, 0.5, { int: true })])]), /whole numbers/);
  });

  it('refuses a range on an input the script fixes to text or a flag', () => {
    refuses(composed([entry({ inputs: { Length: 'close' } }, [len(1, 5, 1)])]), /not a number input/);
    refuses(composed([entry({ inputs: { Length: true } }, [len(1, 5, 1)])]), /not a number input/);
  });

  it('refuses two ranges on one input, and a range with more values than the run limit', () => {
    refuses(composed([entry({}, [len(1, 5, 1), len(6, 9, 1)])]), /two ranges/);
    refuses(composed([entry({}, [len(1, 100000, 1)])]), /more than/);
  });

  it('refuses more than 4 entries, more than 4 filters and a malformed role', () => {
    refuses(composed(Array.from({ length: 5 }, (_, i) => entry({ indicatorId: `e${i}` }))), /at most 4 TradingView indicator entry/);
    refuses(composed(Array.from({ length: 5 }, (_, i) => filter({ indicatorId: `f${i}` }))), /at most 4 TradingView indicator filters/);
    refuses(composed([entry({ rule: above } as never)]), /malformed/);
    refuses(composed([{ role: { name: 'x' }, ranges: [] } as never]), /malformed/);
  });
});

describe('pineRunCount', () => {
  it('is series x distinct input settings x 2 parts, doubled with the baseline', () => {
    const c = composed([entry({}, [len(10, 30, 10)])]);
    expect(pineRunCount(input(c))).toBe(2 * 2 * 3 * 2);
    expect(pineRunCount(input(c, { baseline: true }))).toBe(2 * 2 * 3 * 2 * 2);
  });

  it('counts the same indicator and inputs once when it is both an entry and a filter', () => {
    const both = composed([entry({}, [len(10, 30, 10)]), filter({}, [len(10, 30, 10)])]);
    expect(pineRunCount(input(both))).toBe(2 * 2 * 3 * 2);
    const other = composed([entry({}, [len(10, 30, 10)]), filter({}, [len(20, 40, 10)])]);
    expect(pineRunCount(input(other))).toBe(2 * 2 * 4 * 2);
    const apart = composed([entry({}, [len(10, 30, 10)]), filter({ indicatorId: 'rsi' }, [len(10, 30, 10)])]);
    expect(pineRunCount(input(apart))).toBe(2 * 2 * 6 * 2);
  });

  it('is 0 with no Pine role, or when Composed has no entry rule at all', () => {
    expect(pineRunCount(input({ entryRules: [2], filters: [], trendTfs: [] }))).toBe(0);
    expect(pineRunCount(input(composed([filter()])))).toBe(0);
    expect(pineRunCount(input(composed([filter()], { entryRules: [2] })))).toBe(2 * 2 * 1 * 2);
  });

  it('is over the limit for a role with more settings than the limit, without building them', () => {
    expect(pineRunCount(input(composed([entry({}, [len(1, MAX_PINE_RUNS + 1, 1)])])))).toBe(Infinity);
  });

  it('keys a run by indicator and inputs, whatever the order', () => {
    expect(runKeyOf({ indicatorId: 'a', inputs: { x: 1, y: 2 } })).toBe(runKeyOf({ indicatorId: 'a', inputs: { y: 2, x: 1 } }));
    expect(runKeyOf({ indicatorId: 'a', inputs: { x: 1 } })).not.toBe(runKeyOf({ indicatorId: 'b', inputs: { x: 1 } }));
  });
});
