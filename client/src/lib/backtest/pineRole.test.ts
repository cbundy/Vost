import { describe, expect, it, vi } from 'vitest';
import type { Candle } from '../../types';
import { runOptimizeAsync } from './optimizer';
import { sanitizePineRoles, validatePineRoles, type PineRole } from './pineRole';
import { runAnyBacktest, runFullBacktest } from './runner';
import { DEFAULT_PARAMS } from './strategies';
import { defaultBacktestConfig, type BacktestConfig } from './types';

const pineSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../pine/runtime', async (orig) => {
  const m = await orig<typeof import('../pine/runtime')>();
  return {
    ...m,
    runPine: (...args: Parameters<typeof m.runPine>) => {
      pineSpy.calls++;
      return m.runPine(...args);
    },
  };
});

/** A seeded random walk, so the runs are repeatable and cross often. */
function walk(n = 500, seed = 7): Candle[] {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  let c = 100;
  return Array.from({ length: n }, (_, i) => {
    const open = c;
    c = Math.max(5, c + (rnd() - 0.5) * 4);
    return { time: 1_600_000_000 + i * 86400, open, high: Math.max(open, c) + 1, low: Math.min(open, c) - 1, close: c, volume: 1000 + ((i * 37) % 400) };
  });
}

const header = '//@version=6\n';
const SMA_CROSS = `${header}indicator("Two SMAs", overlay=true)
len1 = input.int(10, "Fast")
len2 = input.int(30, "Slow")
plot(ta.sma(close, len1), "fast")
plot(ta.sma(close, len2), "slow")
`;
const SMA50 = `${header}indicator("SMA 50", overlay=true)\nplot(ta.sma(close, 50), "sma")\n`;
const SHAPES = `${header}indicator("Shapes", overlay=true)
plotshape(ta.crossover(ta.sma(close, 10), ta.sma(close, 30)), "up")
plotshape(ta.crossunder(ta.sma(close, 10), ta.sma(close, 30)), "down")
`;

const plot = (p: string) => ({ kind: 'plot', plot: p }) as const;
const role = (over: Partial<PineRole> & Pick<PineRole, 'role' | 'rule'>): PineRole => ({
  indicatorId: 'id-1',
  name: 'Test',
  source: SMA_CROSS,
  inputs: {},
  ...over,
});

function composedCfg(over: Partial<BacktestConfig> & { params?: Record<string, number> }): BacktestConfig {
  const { params, ...rest } = over;
  return { ...defaultBacktestConfig(), strategyId: 'composed', allowShort: true, params: { ...DEFAULT_PARAMS.composed, direction: 3, ...params }, ...rest };
}

const tradeKey = (r: { trades: Array<{ entryBar: number; exitBar: number; side: string }> }) => r.trades.map((t) => [t.entryBar, t.exitBar, t.side]);

describe('Pine role as the entry rule', () => {
  const candles = walk();

  it('cross of two SMAs gives the trades of the built-in SMA crossover 10/30', async () => {
    const builtIn = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 1, fast: 10, slow: 30 } }));
    const viaPine = await runAnyBacktest(
      candles,
      composedCfg({ params: { entryRule: 7 }, pineRoles: [role({ role: 'entry', rule: { type: 'cross', a: plot('fast'), b: plot('slow') } })] }),
    );
    expect(builtIn.trades.length).toBeGreaterThan(5);
    expect(tradeKey(viaPine)).toEqual(tradeKey(builtIn));
    expect(viaPine.signals).toEqual(builtIn.signals);
  });

  it('cross of two EMAs matches the built-in EMA crossover once both are warmed', async () => {
    const src = `${header}indicator("EMAs")\nplot(ta.ema(close, 12), "fast")\nplot(ta.ema(close, 26), "slow")\n`;
    const builtIn = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 2, fast: 12, slow: 26 } }));
    const viaPine = await runAnyBacktest(
      candles,
      composedCfg({ params: { entryRule: 7 }, pineRoles: [role({ source: src, role: 'entry', rule: { type: 'cross', a: plot('fast'), b: plot('slow') } })] }),
    );
    const from = 60; // past both EMAs' seeding
    expect(viaPine.signals!.slice(from)).toEqual(builtIn.signals!.slice(from));
  });

  it('script inputs change the result', async () => {
    const rule = { type: 'cross', a: plot('fast'), b: plot('slow') } as const;
    const a = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 7 }, pineRoles: [role({ role: 'entry', rule })] }));
    const b = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 7 }, pineRoles: [role({ role: 'entry', rule, inputs: { Fast: 5, Slow: 20 } })] }));
    expect(tradeKey(b)).not.toEqual(tradeKey(a));
    const builtIn = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 1, fast: 5, slow: 20 } }));
    expect(tradeKey(b)).toEqual(tradeKey(builtIn));
  });

  it('close against a level works as an entry', async () => {
    const r = await runAnyBacktest(
      candles,
      composedCfg({ params: { entryRule: 7 }, pineRoles: [role({ role: 'entry', rule: { type: 'cross', a: plot('slow'), b: { kind: 'level', value: 100 } } })] }),
    );
    expect(r.trades.length).toBeGreaterThan(0);
  });

  it('shape entry enters on the drawn bars', async () => {
    const r = await runAnyBacktest(
      candles,
      composedCfg({ params: { entryRule: 7 }, pineRoles: [role({ source: SHAPES, role: 'entry', rule: { type: 'shape', long: 'up', short: 'down' } })] }),
    );
    const builtIn = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 1, fast: 10, slow: 30 } }));
    expect(r.trades.length).toBeGreaterThan(5);
    // Each shape bar flips the side, as the SMA state does; the first state starts at the first cross.
    expect(r.signals!.filter((s) => s === 1).length).toBeGreaterThan(0);
    expect(r.trades.map((t) => t.entryBar)).toEqual(builtIn.trades.slice(1).map((t) => t.entryBar).slice(0, r.trades.length));
  });

  it('a //@version=4 study source is converted and runs', async () => {
    const v4 = `//@version=4\nstudy("Old", overlay=true)\nplot(sma(close, 10), "fast")\nplot(sma(close, 30), "slow")\n`;
    const builtIn = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 1, fast: 10, slow: 30 } }));
    const r = await runAnyBacktest(
      candles,
      composedCfg({ params: { entryRule: 7 }, pineRoles: [role({ source: v4, role: 'entry', rule: { type: 'cross', a: plot('fast'), b: plot('slow') } })] }),
    );
    expect(tradeKey(r)).toEqual(tradeKey(builtIn));
  });

  it('entry rule 7 without an entry role fails', async () => {
    await expect(runAnyBacktest(candles, composedCfg({ params: { entryRule: 7 } }))).rejects.toThrow('Pick a TradingView indicator for the entry rule');
  });

  it('an entry role is ignored while the entry rule is 1-6', async () => {
    const withRole = composedCfg({ params: { entryRule: 1, fast: 10, slow: 30 }, pineRoles: [role({ source: undefined, role: 'entry', rule: { type: 'cross', a: plot('x'), b: plot('y') } })] });
    const plain = composedCfg({ params: { entryRule: 1, fast: 10, slow: 30 } });
    expect(tradeKey(await runAnyBacktest(candles, withRole))).toEqual(tradeKey(await runAnyBacktest(candles, plain)));
  });
});

describe('Pine role as a filter', () => {
  const candles = walk();
  const filter = (over: Partial<PineRole> = {}) =>
    role({ source: SMA50, name: 'Trend50', role: 'filter', label: 'trend', rule: { type: 'above', a: { kind: 'close' }, b: plot('sma') }, ...over });

  it('close above SMA 50 equals the built-in trend filter, with its own blocked count', async () => {
    const base = { entryRule: 1, fast: 10, slow: 30 };
    const builtIn = await runAnyBacktest(candles, composedCfg({ params: { ...base, trendFilter: 1, trendLen: 50 } }));
    const viaPine = await runAnyBacktest(candles, composedCfg({ params: base, pineRoles: [filter()] }));
    expect(builtIn.filters!.blocked[0].blocked).toBeGreaterThan(0);
    expect(tradeKey(viaPine)).toEqual(tradeKey(builtIn));
    expect(viaPine.filters!.taken).toBe(builtIn.filters!.taken);
    expect(viaPine.filters!.blocked).toEqual([{ key: 'pine', label: 'Trend50 (trend)', blocked: builtIn.filters!.blocked[0].blocked }]);
  });

  it('a custom or missing label prints just the name; it sits after the built-in filters', async () => {
    const r = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 1, trendFilter: 1, trendLen: 50 }, pineRoles: [filter({ label: 'custom' })] }));
    expect(r.filters!.blocked.map((b) => [b.key, b.label])).toEqual([
      ['trend', 'trend'],
      ['pine', 'Trend50'],
    ]);
    const { label: _l, ...noLabel } = filter();
    const r2 = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 1 }, pineRoles: [noLabel as PineRole] }));
    expect(r2.filters!.blocked[0].label).toBe('Trend50');
  });

  it('below mirrors above for longs, and inside keeps both sides within the band', async () => {
    const below = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 1 }, pineRoles: [filter({ rule: { type: 'below', a: { kind: 'close' }, b: plot('sma') } })] }));
    const above = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 1 }, pineRoles: [filter()] }));
    // Longs need close below the line, shorts above it: the opposite of 'above'.
    expect(tradeKey(below)).not.toEqual(tradeKey(above));
    const wide = await runAnyBacktest(
      candles,
      composedCfg({ params: { entryRule: 1 }, pineRoles: [filter({ rule: { type: 'inside', a: { kind: 'close' }, lo: { kind: 'level', value: 0 }, hi: { kind: 'level', value: 1e9 } } })] }),
    );
    const none = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 1 } }));
    expect(tradeKey(wide)).toEqual(tradeKey(none));
    expect(wide.filters!.blocked[0].blocked).toBe(0);
  });

  it('na warm-up blocks nothing and is not counted', async () => {
    const r = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 1, fast: 3, slow: 5 }, pineRoles: [filter()] }));
    // Signals before bar 49 (SMA 50 not ready) are not signals at all.
    expect(r.filters!.signals).toBe((await runAnyBacktest(candles, composedCfg({ params: { entryRule: 1, fast: 3, slow: 5, trendFilter: 1, trendLen: 50 } }))).filters!.signals);
    expect(r.signals!.slice(0, 49).every((s) => s == null)).toBe(true);
  });

  it('the result config carries no indicator source', async () => {
    const r = await runAnyBacktest(candles, composedCfg({ params: { entryRule: 1 }, pineRoles: [filter()] }));
    expect(r.config.pineRoles![0].source).toBeUndefined();
    expect(r.config.pineRoles![0].indicatorId).toBe('id-1');
  });
});

describe('failures name the indicator', () => {
  const candles = walk(200);
  const run = (r: PineRole, entryRule = 1) => runAnyBacktest(candles, composedCfg({ params: { entryRule }, pineRoles: [r] }));
  const f = (over: Partial<PineRole>) => role({ name: 'Mine', role: 'filter', rule: { type: 'above', a: { kind: 'close' }, b: plot('slow') }, ...over });

  it('a removed indicator', async () => {
    await expect(run(f({ source: undefined }))).rejects.toThrow('"Mine" is no longer stored');
  });
  it('a missing plot', async () => {
    await expect(run(f({ rule: { type: 'above', a: { kind: 'close' }, b: plot('nope') } }))).rejects.toThrow('"Mine" has no plot titled "nope"');
  });
  it('a strategy script', async () => {
    const strat = `${header}strategy("S")\nplot(close, "slow")\n`;
    await expect(run(f({ source: strat }))).rejects.toThrow('"Mine" is a strategy');
  });
  it('a script error', async () => {
    await expect(run(f({ source: `${header}indicator("Bad")\nplot(nonsense(close), "slow")\n` }))).rejects.toThrow(/"Mine":/);
  });
  it('a shape rule on a line plot', async () => {
    await expect(run(role({ name: 'Mine', role: 'entry', rule: { type: 'shape', long: 'fast' } }), 7)).rejects.toThrow('"Mine"');
  });
  it('malformed roles and too many roles', async () => {
    await expect(run({ ...f({}), rule: { type: 'bogus' } } as unknown as PineRole)).rejects.toThrow('malformed');
    const many = Array.from({ length: 5 }, () => f({}));
    await expect(runAnyBacktest(candles, composedCfg({ pineRoles: many }))).rejects.toThrow('at most 4');
    const twoEntries = [role({ role: 'entry', rule: { type: 'cross', a: plot('fast'), b: plot('slow') } }), role({ role: 'entry', rule: { type: 'cross', a: plot('fast'), b: plot('slow') } })];
    expect(() => validatePineRoles(twoEntries)).toThrow('at most one');
  });
  it('runFullBacktest with roles but no context throws', () => {
    expect(() => runFullBacktest(candles, composedCfg({ pineRoles: [f({})] }))).toThrow('need the async runner');
  });
});

describe('prefs sanitising', () => {
  it('drops malformed roles and keeps good ones', () => {
    const good = role({ role: 'filter', rule: { type: 'above', a: { kind: 'close' }, b: { kind: 'level', value: 1 } } });
    expect(sanitizePineRoles([good, { nope: 1 }, null, { ...good, rule: { type: 'inside' } }])).toEqual([good]);
    expect(sanitizePineRoles('x')).toEqual([]);
  });
});

describe('the memo', () => {
  it('an optimizer grid runs each indicator once', async () => {
    const candles = walk(300);
    const cfg = composedCfg({
      params: { entryRule: 1, fast: 5, slow: 20 },
      pineRoles: [role({ source: SMA50, name: 'T', role: 'filter', rule: { type: 'above', a: { kind: 'close' }, b: plot('sma') } })],
    });
    pineSpy.calls = 0;
    const out = await runOptimizeAsync(candles, cfg, {
      sweeps: [
        { key: 'fast', from: 3, to: 5, step: 1 },
        { key: 'slow', from: 20, to: 30, step: 5 },
      ],
      metric: 'totalReturnPct',
    });
    expect(out.combos).toBe(9);
    expect(out.rows.length).toBe(9);
    expect(pineSpy.calls).toBe(1);
  });
});
