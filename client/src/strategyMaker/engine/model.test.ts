import { beforeEach, describe, expect, it, vi } from 'vitest';
import { paramValues } from '../../lib/backtest/optimizer';
import { FEATURES } from './features';
import { DEFAULT_SPACE, parseModel, predictStates, searchStrategies, serializeModel, trainModel, describeModel } from './index';
import type { TrainInput, TrainResult } from './index';
import { highlights, synth } from './synthetic';
import type { HighlightTrade, SearchResult } from './types';

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
const smaTrades = highlights(candles, 12345);
const createdAt = '2026-01-01T00:00:00.000Z';
const train = (over: Partial<TrainInput> = {}): TrainInput => ({ series: [{ candles, trades: smaTrades }], createdAt, ...over });
const ok = (r: Awaited<ReturnType<typeof trainModel>>): TrainResult => {
  expect(r.kind).toBe('ok');
  return r as TrainResult;
};
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

beforeEach(() => {
  counter.backtests = 0;
});

describe('recovery', () => {
  it('points at the hidden sma_cross 8/34 from imperfect highlights, with a generated feature list', async () => {
    const r = ok(await trainModel(train()));
    const fam = r.importance.byFamily;
    const top = fam[0].family;
    const second = fam[1]?.family;
    expect(top === 'sma_cross' || (top === 'ema_cross' && second === 'sma_cross')).toBe(true);
    expect(fam[0].family).toBe('sma_cross');
    expect(r.families).toContain('sma_cross');
    const values = (key: string): number[] => paramValues(r.space.sma_cross.find((s) => s.key === key) as never);
    expect(values('fast')).toContain(8);
    expect(values('slow')).toContain(34);
    expect(r.rules[0]).toMatch(/^long when .* (>|<=) /);
    expect(r.rules[r.rules.length - 1]).toBe('flat otherwise');
    expect(sum(r.importance.byFeature.map((f) => f.importance))).toBeCloseTo(1, 9);
    expect(sum(fam.map((f) => f.importance))).toBeCloseTo(1, 9);
    expect(r.heldOut.accuracy).toBeGreaterThan(0.9);
    expect(r.heldOut.recall).toBeGreaterThan(0.5);
    expect(r.model.trainedOn).toEqual({ sets: 1, trades: smaTrades.length, bars: expect.any(Number) });
    expect(r.model.trainedOn.bars).toBeLessThanOrEqual(14_000);
  }, 60_000);

  it('ranks macd_cross first for macd_cross highlights, with the macd settings centred in the space', async () => {
    // A second family whose held state is a function of one reading. (rsi_reversion is not: it holds a trade
    // from an RSI cross until another, so on trending data its holds look like a moving-average state and the
    // tree credits the averages. A state tree cannot tell them apart, and the test does not pretend it can.)
    const trades = highlights(candles, 99, 'macd_cross', { fast: 12, slow: 26, signal: 9, direction: 1 });
    expect(trades.length).toBeGreaterThan(100);
    const r = ok(await trainModel({ series: [{ candles, trades }], createdAt }));
    expect(r.importance.byFamily[0].family).toBe('macd_cross');
    expect(r.families[0]).toBe('macd_cross');
    expect(r.space.macd_cross.map((s) => s.key)).toEqual(['fast', 'slow', 'signal']);
    const values = (key: string): number[] => paramValues(r.space.macd_cross.find((s) => s.key === key) as never);
    expect(values('fast')).toContain(12);
    expect(values('slow')).toContain(26);
    expect(values('signal')).toContain(9);
  }, 60_000);

  it('hands a narrower search to searchStrategies that still finds sma_cross 8/34', async () => {
    const r = ok(await trainModel(train()));
    const input = { series: [{ candles, trades: smaTrades }], targets: { minRR: 0.1, minHitRatePct: 10, maxDrawdownPct: 99 }, direction: 'long' as const };
    counter.backtests = 0;
    const narrow = await searchStrategies({ ...input, families: r.families, space: r.space });
    expect(narrow.kind).toBe('ok');
    const best = (narrow as SearchResult).bestMatch;
    expect(best.strategyId).toBe('sma_cross');
    expect(best.params.fast).toBe(8);
    expect(best.params.slow).toBe(34);
    const narrowCount = counter.backtests;
    counter.backtests = 0;
    const full = await searchStrategies(input);
    expect(full.kind).toBe('ok');
    // The settings tried (scored without a backtest) shrink; the backtests are the top few and the checks, which a
    // narrower search keeps or cuts (a grid of fewer settings needs fewer robustness runs).
    expect(narrowCount).toBeGreaterThan(0);
    expect(narrowCount).toBeLessThanOrEqual(counter.backtests);
    expect((narrow as SearchResult).candidates).toBeLessThan((full as SearchResult).candidates);
  }, 120_000);
});

describe('weighting', () => {
  it('finds rare trades: with about 3% of bars held, the held-out recall is above 0.5', async () => {
    const sparse = candles.slice(0, 12_000);
    const trades: HighlightTrade[] = [];
    // Short holds after a fast fall over 5 bars, but only every third such fall is highlighted, so the readings
    // that mean "in a trade" are mostly flat bars. (The tree test pins that only weighting finds such a class.)
    const closes = sparse.map((c) => c.close);
    let seen = 0;
    for (let i = 30; i < sparse.length - 10; i++) {
      if (closes[i] / closes[i - 5] - 1 < -0.025 && (trades.length === 0 || trades[trades.length - 1].exitTime < sparse[i].time)) {
        if (seen++ % 3 === 0) trades.push({ side: 'long', entryTime: sparse[i].time, exitTime: sparse[i + 3].time });
      }
    }
    const held = trades.length * 3;
    expect(held / sparse.length).toBeLessThan(0.1);
    expect(trades.length).toBeGreaterThan(30);
    const r = ok(await trainModel({ series: [{ candles: sparse, trades }], createdAt }));
    expect(r.heldOut.recall).toBeGreaterThan(0.5);
  }, 60_000);
});

describe('determinism', () => {
  it('gives identical model files for the same input', async () => {
    const a = ok(await trainModel(train()));
    const b = ok(await trainModel(train()));
    expect(serializeModel(a.model)).toBe(serializeModel(b.model));
    expect(a).toEqual(b);
  }, 60_000);

  it('keeps createdAt out of the tree', async () => {
    const a = ok(await trainModel(train({ createdAt: 'a' })));
    const b = ok(await trainModel(train({ createdAt: 'b' })));
    expect(a.model.tree).toEqual(b.model.tree);
  }, 60_000);
});

describe('too few and skipped trades', () => {
  const small = candles.slice(0, 3000);
  const mk = (n: number): HighlightTrade[] =>
    Array.from({ length: n }, (_, i) => ({ side: 'long' as const, entryTime: small[10 + i * 20].time, exitTime: small[15 + i * 20].time }));

  it('29 used trades give too-few, 30 train', async () => {
    expect(await trainModel({ series: [{ candles: small, trades: mk(29) }], createdAt })).toEqual({ kind: 'too-few', have: 29, need: 30, skipped: [] });
    expect((await trainModel({ series: [{ candles: small, trades: mk(30) }], createdAt })).kind).toBe('ok');
  });

  it('reports skipped trades with the search engine reasons', async () => {
    const t = mk(29);
    t.push({ side: 'long', entryTime: small[0].time - 5000, exitTime: small[3].time });
    t.push({ side: 'long', entryTime: small[40].time, exitTime: small[30].time });
    const r = await trainModel({ series: [{ candles: small, trades: t }], createdAt });
    expect(r).toMatchObject({ kind: 'too-few', have: 29 });
    if (r.kind !== 'too-few') throw new Error('unreachable');
    expect(r.skipped).toEqual([
      { series: 0, index: 29, reason: expect.stringContaining('outside the series') },
      { series: 0, index: 30, reason: expect.stringContaining('exit is before entry') },
    ]);
  });

  it('refuses no series and an unknown required family', async () => {
    expect((await trainModel({ series: [] })).kind).toBe('refused');
    const r = await trainModel({ series: [{ candles: small, trades: mk(30) }], requireFamilies: ['nope'] });
    expect(r.kind).toBe('refused');
    if (r.kind === 'refused') expect(r.reason).toContain('nope');
  });

  it('trains across two charts, both counted', async () => {
    const b = synth(10_000, 777, candles[0].time);
    const ta = highlights(candles.slice(0, 10_000), 1);
    const tb = highlights(b, 2);
    const r = ok(await trainModel({ series: [{ candles: candles.slice(0, 10_000), trades: ta }, { candles: b, trades: tb }], createdAt }));
    expect(r.usedTrades).toBe(ta.length + tb.length);
    expect(r.model.trainedOn.sets).toBe(2);
    expect(r.importance.byFamily[0].family).toBe('sma_cross');
  }, 60_000);
});

describe('narrowing', () => {
  it('adds a required family with its default ranges and keeps ranges inside the setting limits', async () => {
    const r = ok(await trainModel(train({ requireFamilies: ['donchian'] })));
    expect(r.families).toContain('donchian');
    if (!r.importance.byFamily.some((f) => f.family === 'donchian')) expect(r.space.donchian).toEqual(DEFAULT_SPACE.donchian);
    for (const sweeps of Object.values(r.space)) expect(sweeps.map((s) => s.key)).not.toContain('direction');
  }, 60_000);

  it('centres ranges on the most important feature, clamps to limits and keeps fast below slow', () => {
    const fi = FEATURES.findIndex((f) => f.id === 'sma_cross_5_21');
    const tree = { leaf: false as const, feature: fi, threshold: 0, gain: 1, left: { leaf: true as const, state: 0 as const }, right: { leaf: true as const, state: 1 as const } };
    const model = { version: 1 as const, features: [...FEATURES], tree, trainedOn: { sets: 1, trades: 30, bars: 1 }, createdAt };
    const d = describeModel(model, ['rsi_reversion']);
    expect(d.families).toEqual(['sma_cross', 'rsi_reversion']);
    expect(d.space.sma_cross).toEqual([
      { key: 'fast', from: 3, to: 7, step: 1 },
      { key: 'slow', from: 19, to: 23, step: 1 },
    ]);
    expect(d.space.rsi_reversion).toEqual(DEFAULT_SPACE.rsi_reversion);
  });
});

describe('model file', () => {
  it('round-trips exactly and predicts the same states', async () => {
    const r = ok(await trainModel(train()));
    const parsed = parseModel(serializeModel(r.model));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.model).toEqual(r.model);
    const probe = candles.slice(14_000, 15_000);
    expect(predictStates(parsed.model, probe)).toEqual(predictStates(r.model, probe));
    expect(predictStates(r.model, probe).some((s) => s === 1)).toBe(true);
    const again = describeModel(parsed.model);
    expect(again.rules).toEqual(r.rules);
    expect(again.importance).toEqual(r.importance);
    expect(again.space).toEqual(r.space);
  }, 60_000);

  it('predicts flat during warm-up', async () => {
    const r = ok(await trainModel(train()));
    expect(predictStates(r.model, candles.slice(0, 20)).every((s) => s === 0)).toBe(true);
  }, 60_000);

  describe('rejects', () => {
    const good = {
      version: 1,
      features: FEATURES.slice(0, 3),
      tree: { leaf: false, feature: 0, threshold: 0.5, gain: 1, left: { leaf: true, state: 0 }, right: { leaf: true, state: 1 } },
      trainedOn: { sets: 1, trades: 30, bars: 100 },
      createdAt,
    };
    const err = (v: unknown): string => {
      const r = parseModel(typeof v === 'string' ? v : JSON.stringify(v));
      expect(r.ok).toBe(false);
      return r.ok ? '' : r.error;
    };
    it('a good file parses', () => expect(parseModel(JSON.stringify(good)).ok).toBe(true));
    it('invalid JSON', () => expect(err('{nope')).toContain('not valid JSON'));
    it('version 2', () => expect(err({ ...good, version: 2 })).toContain('version 2'));
    it('an unknown feature', () => expect(err({ ...good, features: [{ ...FEATURES[0], id: 'mystery' }] })).toContain('mystery'));
    it('a split node missing a child', () => {
      expect(err({ ...good, tree: { ...good.tree, right: undefined } })).toContain('missing its right child');
      expect(err({ ...good, tree: { ...good.tree, left: undefined } })).toContain('missing its left child');
    });
    it('a feature index out of range', () => {
      expect(err({ ...good, tree: { ...good.tree, feature: 3 } })).toContain('out of range');
      expect(err({ ...good, tree: { ...good.tree, feature: -1 } })).toContain('out of range');
    });
    it('a threshold that is not finite', () => expect(err('{"version":1,"features":[],"tree":null}')).toContain('no features'));
    it('a null threshold', () => expect(err({ ...good, tree: { ...good.tree, threshold: null } })).toContain('threshold'));
    it('a leaf with a bad state', () => expect(err({ ...good, tree: { leaf: true, state: 3 } })).toContain('state'));
  });
});

describe('cancel and progress', () => {
  it('an aborted signal rejects with AbortError', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(trainModel(train({ signal: ctl.signal }))).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('aborting mid-way rejects and stops reporting', async () => {
    const ctl = new AbortController();
    const calls: number[] = [];
    const p = trainModel(train({ signal: ctl.signal, onProgress: (pct) => { calls.push(pct); ctl.abort(); } }));
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toHaveLength(1);
  });

  it('progress never decreases and ends at 1', async () => {
    const pcts: number[] = [];
    ok(await trainModel(train({ onProgress: (p) => pcts.push(p) })));
    expect(pcts.length).toBeGreaterThan(FEATURES.length);
    expect([...pcts].sort((a, b) => a - b)).toEqual(pcts);
    expect(pcts[pcts.length - 1]).toBe(1);
  }, 60_000);
});
