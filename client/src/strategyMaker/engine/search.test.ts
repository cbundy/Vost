import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gridSize, MAX_GRID_COMBOS } from '../../lib/backtest/optimizer';
import { getStrategy, stylesOf } from '../../lib/backtest/strategies';
import { DEFAULT_SPACE, validParams } from './search';
import { SIGNAL_FAMILIES } from './types';
import { searchStrategies } from './index';
import { highlights, synth } from './synthetic';
import type { HighlightTrade, SearchInput, SearchResult } from './types';

const counter = vi.hoisted(() => ({ backtests: 0 }));
vi.mock('../../lib/backtest/engine', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../lib/backtest/engine')>();
  return {
    ...mod,
    runBacktest: (...args: Parameters<typeof mod.runBacktest>) => {
      counter.backtests++;
      return mod.runBacktest(...args);
    },
  };
});

const candles = synth(20_000, 20260101);
const trades = highlights(candles, 12345);
const base = (over: Partial<SearchInput> = {}): SearchInput => ({
  series: [{ candles, trades }],
  targets: { minRR: 0.1, minHitRatePct: 10, maxDrawdownPct: 99 },
  direction: 'long',
  ...over,
});
const ok = (r: Awaited<ReturnType<typeof searchStrategies>>): SearchResult => {
  expect(r.kind).toBe('ok');
  return r as SearchResult;
};

beforeEach(() => {
  counter.backtests = 0;
});

describe('search recovery', () => {
  it('finds the hidden sma_cross 8/34 from imperfect highlights', async () => {
    expect(trades.length).toBeGreaterThan(100);
    const r = ok(await searchStrategies(base()));
    const top = r.bestMatch;
    expect(top.strategyId).toBe('sma_cross');
    expect(top.params.fast).toBeGreaterThanOrEqual(6);
    expect(top.params.fast).toBeLessThanOrEqual(10);
    expect(top.params.slow).toBeGreaterThanOrEqual(30);
    expect(top.params.slow).toBeLessThanOrEqual(38);
    expect(top.match.f1).toBeGreaterThan(0.85);
    expect(r.recommendations.length).toBe(8);
    expect(top.selection.trades).toBeGreaterThan(0);
    expect(top.heldOut.trades).toBeGreaterThan(0);
  }, 60_000);

  it('is deterministic', async () => {
    const small = base({ families: ['sma_cross'] });
    expect(await searchStrategies(small)).toEqual(await searchStrategies(small));
  }, 60_000);
});

describe('minimum trades and skipped trades', () => {
  const small = candles.slice(0, 3000);
  const mk = (n: number): HighlightTrade[] =>
    Array.from({ length: n }, (_, i) => ({ side: 'long' as const, entryTime: small[10 + i * 20].time, exitTime: small[15 + i * 20].time }));

  it('29 trades give too-few and run nothing, 30 run', async () => {
    const few = await searchStrategies(base({ series: [{ candles: small, trades: mk(29) }] }));
    expect(few).toMatchObject({ kind: 'too-few', have: 29, need: 30 });
    expect(counter.backtests).toBe(0);
    const enough = await searchStrategies(base({ series: [{ candles: small, trades: mk(30) }], families: ['donchian'] }));
    expect(enough.kind).toBe('ok');
  });

  it('a skipped trade does not count and is reported with its reason', async () => {
    const t = mk(29);
    t.push({ side: 'long', entryTime: small[0].time - 5000, exitTime: small[3].time });
    t.push({ side: 'long', entryTime: small[40].time, exitTime: small[30].time });
    const r = await searchStrategies(base({ series: [{ candles: small, trades: t }] }));
    expect(r).toMatchObject({ kind: 'too-few', have: 29 });
    if (r.kind !== 'too-few') throw new Error('unreachable');
    expect(r.skipped).toEqual([
      { series: 0, index: 29, reason: expect.stringContaining('outside the series') },
      { series: 0, index: 30, reason: expect.stringContaining('exit is before entry') },
    ]);
  });

  it('two series together count and score as the sum, and a trade outside its series is skipped', async () => {
    const a = candles.slice(0, 10_000);
    const b = synth(10_000, 777, a[0].time);
    const ta = highlights(a, 1);
    const tb = highlights(b, 2);
    const outside: HighlightTrade = { side: 'long', entryTime: a[0].time - 1e6, exitTime: a[0].time - 5e5 };
    const r = ok(
      await searchStrategies(base({ series: [{ candles: a, trades: ta }, { candles: b, trades: [...tb, outside] }], families: ['sma_cross'] })),
    );
    expect(r.usedTrades).toBe(ta.length + tb.length);
    expect(r.skipped).toEqual([{ series: 1, index: tb.length, reason: expect.stringContaining('outside the series') }]);
    expect(r.bestMatch.params.fast).toBe(8);
    expect(r.bestMatch.params.slow).toBe(34);
    expect(r.bestMatch.match.f1).toBeGreaterThan(0.85);
  }, 60_000);
});

describe('targets and validation', () => {
  it('an impossible drawdown gives closest with a drawdown gap and no best-meeting', async () => {
    const r = ok(await searchStrategies(base({ families: ['sma_cross'], targets: { maxDrawdownPct: 0 } })));
    expect(r.bestMeetingTargets).toBeNull();
    expect(r.closest).not.toBeNull();
    const gap = r.closest?.gaps.find((g) => g.metric === 'maxDrawdownPct');
    expect(gap?.text).toMatch(/^maxDrawdownPct \d+\.\d > 0$/);
    expect(r.validation.validated).toBe(false);
  }, 60_000);

  it('loose targets give a best meeting the targets, ranked first', async () => {
    const r = ok(await searchStrategies(base({ families: ['sma_cross'], targets: {} })));
    expect(r.bestMeetingTargets).not.toBeNull();
    expect(r.closest).toBeNull();
    expect(r.recommendations[0]).toBe(r.bestMeetingTargets);
    expect(r.validation.checks.map((c) => c.id)).toEqual(['held-out', 'walk-forward', 'robustness', 'monte-carlo']);
  }, 60_000);

  it('a held-out drawdown over the target is not validated, and the checks say which passed', async () => {
    // Loose on selection (99%), but a tiny target for the held-out drawdown is the same target: use one that
    // the selection part meets and the held-out part cannot, by checking the verdict follows the held-out gaps.
    const loose = ok(await searchStrategies(base({ families: ['sma_cross'], targets: { maxDrawdownPct: 99 } })));
    const dd = loose.validation.candidate.heldOut.maxDrawdownPct;
    expect(dd).toBeGreaterThan(0);
    expect(loose.validation.validated).toBe(true);
    const tight = ok(await searchStrategies(base({ families: ['sma_cross'], targets: { maxDrawdownPct: dd / 2 } })));
    expect(tight.validation.validated).toBe(false);
    expect(tight.validation.heldOutGaps.map((g) => g.metric)).toContain('maxDrawdownPct');
    const held = tight.validation.checks.find((c) => c.id === 'held-out');
    expect(held?.passed).toBe(false);
    expect(held?.detail).toContain('maxDrawdownPct');
  }, 60_000);
});

describe('refusals, cap and cancel', () => {
  it('refuses a space over the grid cap before any backtest', async () => {
    const r = await searchStrategies(
      base({ families: ['sma_cross'], space: { sma_cross: [{ key: 'fast', from: 1, to: 500, step: 1 }, { key: 'slow', from: 2, to: 1000, step: 1 }] } }),
    );
    expect(r.kind).toBe('refused');
    if (r.kind === 'refused') expect(r.reason).toContain(MAX_GRID_COMBOS.toLocaleString('en-US'));
    expect(counter.backtests).toBe(0);
  });

  it('refuses an unknown family and a custom one', async () => {
    for (const id of ['nope', 'buy_hold', 'pine', 'custom']) {
      const r = await searchStrategies(base({ families: [id] }));
      expect(r.kind).toBe('refused');
      if (r.kind === 'refused') expect(r.reason).toContain(id);
    }
    expect(counter.backtests).toBe(0);
  });

  it('refuses a setting the family does not have', async () => {
    const r = await searchStrategies(base({ families: ['donchian'], space: { donchian: [{ key: 'fast', from: 1, to: 2, step: 1 }] } }));
    expect(r.kind).toBe('refused');
  });

  it('abort after the first progress call rejects and reports no more progress', async () => {
    const ctl = new AbortController();
    const calls: number[] = [];
    const p = searchStrategies(
      base({
        signal: ctl.signal,
        onProgress: (pct) => {
          calls.push(pct);
          ctl.abort();
        },
      }),
    );
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(1);
  });

  it('reports progress at least once per 1% of candidates, never decreasing', async () => {
    const pcts: number[] = [];
    const r = ok(await searchStrategies(base({ families: ['donchian'], onProgress: (p) => pcts.push(p) })));
    expect(pcts.length).toBeGreaterThanOrEqual(Math.min(100, r.candidates));
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
    expect(pcts[pcts.length - 1]).toBe(1);
  }, 60_000);
});

describe('default grids of the new families', () => {
  const size = (id: string): number => gridSize({ sweeps: DEFAULT_SPACE[id] });
  it('have the designed sizes and real parameter keys', () => {
    expect([size('pullback'), size('reversal'), size('momentum_breakout')]).toEqual([48, 20, 144]);
    for (const id of ['pullback', 'reversal', 'momentum_breakout']) {
      const known = getStrategy(id).params.map((p) => p.key);
      for (const s of DEFAULT_SPACE[id]) expect(known).toContain(s.key);
    }
  });
  it('keep dip below target for every pullback point', () => {
    for (const dip of [30, 35, 40, 45]) for (const target of [60, 70, 80]) expect(validParams('pullback', { dip, target })).toBe(true);
    expect(validParams('pullback', { dip: 45, target: 40 })).toBe(false);
  });
  it('keep a default search over every family within the budget', () => {
    const total = SIGNAL_FAMILIES.reduce((a, id) => a + size(id), 0);
    expect(total).toBe(1187);
    expect(total).toBeLessThan(MAX_GRID_COMBOS);
  });
});

describe('styles of the searchable families', () => {
  it('every searchable family has a style', () => {
    for (const id of SIGNAL_FAMILIES) expect(stylesOf(id).length).toBeGreaterThan(0);
  });
});
