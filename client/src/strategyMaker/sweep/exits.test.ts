import { describe, expect, it } from 'vitest';
import { exitCount, exitKey, exitOfCandidate, exitShort, exitSortValue, exitWords, exitsFor, exitsOf } from './exits';
import type { ExitGrid, SweepExit } from './types';

const stop = (mode: 'at-entry' | 'trailing', over: object = {}) => ({
  indicatorId: 'st', name: 'Supertrend', inputs: { Factor: 3, Length: 10 }, role: 'stop' as const, mode, rule: { type: 'level' as const, plot: 'Supertrend' }, ...over,
});
const grid = (mode: 'at-entry' | 'trailing', kinds: ExitGrid['kinds'] = ['pine']): ExitGrid => ({ stopMults: [1, 2], tpMults: [2, 3], kinds, pineStop: stop(mode) });
const pineExits = (mode: 'at-entry' | 'trailing') => exitsOf(2, grid(mode));

describe('the TradingView indicator stop exit', () => {
  it('is one exit per take profit multiple, an R target on the plot stop with no other stop', () => {
    const xs = pineExits('at-entry');
    expect(xs.map((x) => [x.kind, x.stopMult, x.tpMult])).toEqual([['pine', 0, 2], ['pine', 0, 3]]);
    expect(xs[1].config).toEqual({ stopLossPct: null, takeProfitPct: null, takeProfitMode: 'r', takeProfitR: 3 });
    expect(xs[1].pineStop).toEqual(stop('at-entry'));
  });

  it('counts for Composed settings only, after the other kinds', () => {
    const g = grid('trailing', ['atr_trail', 'pine', 'range']);
    expect(exitCount(g)).toBe(2 * 2 * 2);
    expect(exitCount(g, true)).toBe(2 * 2 * 2 + 2);
    const xs = exitsOf(2, g);
    expect(xs).toHaveLength(10);
    expect(xs.slice(-2).map((x) => x.kind)).toEqual(['pine', 'pine']);
    expect(exitsFor(xs, false)).toHaveLength(8);
    expect(exitsFor(xs, true)).toBe(xs);
  });

  it('is ignored without the kind, and not built without a stop role', () => {
    expect(exitsOf(2, { ...grid('at-entry'), kinds: ['range'] }).every((x) => x.kind === 'range')).toBe(true);
    expect(exitCount({ ...grid('at-entry'), kinds: ['range'] }, true)).toBe(4);
    expect(exitsOf(2, { stopMults: [1], tpMults: [2], kinds: ['pine'] })).toEqual([]);
  });

  it('reads in words, a short form, a sort order and a key', () => {
    const [fixed] = pineExits('at-entry');
    const [trail] = pineExits('trailing');
    expect(exitWords(fixed)).toBe('stop at Supertrend Supertrend, take profit 2R');
    expect(exitWords(trail)).toBe('trailing stop at Supertrend Supertrend, take profit 2R');
    expect(exitShort(fixed)).toBe('Supertrend Supertrend stop / 2R');
    expect(exitShort(trail)).toBe('Supertrend Supertrend trailing / 2R');
    const [atr] = exitsOf(2, { stopMults: [9], tpMults: [1], kinds: ['atr_trail'] });
    const [a, b] = pineExits('at-entry');
    expect(exitSortValue(atr)).toBeLessThan(exitSortValue(a));
    expect(exitSortValue(a)).toBeLessThan(exitSortValue(b));
    expect(new Set([exitKey(a), exitKey(b), exitKey(trail)]).size).toBe(3);
    const other = exitsOf(2, { ...grid('at-entry'), pineStop: stop('at-entry', { inputs: { Factor: 2, Length: 10 } }) })[0];
    expect(exitKey(other)).not.toBe(exitKey(a));
    // The order of the inputs does not change the key.
    expect(exitKey(exitsOf(2, { ...grid('at-entry'), pineStop: stop('at-entry', { inputs: { Length: 10, Factor: 3 } }) })[0])).toBe(exitKey(a));
  });

  it('leaves a stored result without the kind reading as before', () => {
    const old = exitOfCandidate({ stopLossPct: 2, takeProfitPct: 4 });
    expect(exitWords(old)).toBe('stop 2.00%, take profit 4.00%');
    expect(exitShort(old as SweepExit)).toBe('2.00% / 4.00%');
    expect(exitKey(old)).not.toContain('|st');
  });
});
