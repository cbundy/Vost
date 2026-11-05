import { describe, expect, it } from 'vitest';
import { SIGNAL_FAMILIES } from './engine';
import { highlights, synth } from './engine/synthetic';
import { loadSeries, moreNeeded, runEngine, runFind, tooFewMessage, tradesOf, type FindInputs, type Loaders } from './run';
import { setId, type HighlightSet } from './store';
import type { HighlightTrade } from './brush';

const candles = synth(8000, 20260101);
const trades = highlights(candles, 12345);
const inputs = (over: Partial<FindInputs> = {}): FindInputs => ({
  direction: 'long',
  families: [...SIGNAL_FAMILIES],
  risk: { feeBps: 10, slippageBps: 5, stopLossPct: null, takeProfitPct: null },
  targets: { minRR: 0.1, minHitRatePct: 10, maxDrawdownPct: 99 },
  ...over,
});
const csvSet = (name: string, t: HighlightTrade[] = trades, c = candles): HighlightSet => ({
  id: setId({ kind: 'csv', name }),
  version: 1,
  source: { kind: 'csv', name },
  trades: t,
  candles: c,
  updatedAt: 1,
});
const loaders: Loaders = {
  provider: async (s) => ({ ok: false, error: `no network for ${s.symbol}` }),
  library: (id) => ({ ok: false, error: `no dataset ${id}` }),
};

describe('runEngine', () => {
  it('recommends the hidden sma_cross, explains the trades and validates', async () => {
    const seen: Array<[number, string]> = [];
    const out = await runEngine([{ candles, trades }], inputs(), undefined, (p, s) => seen.push([p, s]));
    if (out.kind !== 'ok') throw new Error(`expected ok, got ${out.kind}`);
    const top = out.search.bestMatch;
    expect(top.strategyId).toBe('sma_cross');
    expect(top.params.fast).toBeGreaterThanOrEqual(6);
    expect(top.params.fast).toBeLessThanOrEqual(10);
    expect(top.params.slow).toBeGreaterThanOrEqual(30);
    expect(top.params.slow).toBeLessThanOrEqual(38);
    expect(out.model.rules.length).toBeGreaterThan(0);
    expect(out.search.validation.checks.length).toBe(4);
    // progress: never down, and the four stages in order
    expect(seen.map((x) => x[0])).toEqual([...seen.map((x) => x[0])].sort((a, b) => a - b));
    expect([...new Set(seen.map((x) => x[1]))]).toEqual(['Training', 'Searching', 'Validating']);
    expect(seen[seen.length - 1][0]).toBe(1);
  }, 120_000);

  it('gives the closest result with its gaps when no candidate meets the targets', async () => {
    const out = await runEngine([{ candles, trades }], inputs({ targets: { minRR: 500 }, families: ['sma_cross'] }));
    if (out.kind !== 'ok') throw new Error(`expected ok, got ${out.kind}`);
    expect(out.search.bestMeetingTargets).toBeNull();
    expect(out.search.closest?.gaps.length).toBeGreaterThan(0);
  }, 120_000);

  it('reports too few trades with how many more are needed', async () => {
    const out = await runEngine([{ candles, trades: trades.slice(0, 29) }], inputs());
    expect(out).toEqual({ kind: 'too-few', have: 29, need: 30 });
    expect(tooFewMessage(29, 30)).toContain('1 more trade needed');
    expect(moreNeeded(10)).toBe('20 more trades needed');
  });

  it('searches only the allowed families, falling back to them when the model names none of them', async () => {
    const out = await runEngine([{ candles, trades }], inputs({ families: ['donchian'] }));
    if (out.kind !== 'ok') throw new Error(`expected ok, got ${out.kind}`);
    expect(out.model.families).not.toEqual(['donchian']);
    expect(new Set(out.search.recommendations.map((c) => c.strategyId))).toEqual(new Set(['donchian']));
  }, 120_000);

  it('rejects with an AbortError when the signal is aborted, before and during the run', async () => {
    const ctl = new AbortController();
    ctl.abort();
    await expect(runEngine([{ candles, trades }], inputs(), ctl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const mid = new AbortController();
    await expect(runEngine([{ candles, trades }], inputs(), mid.signal, () => mid.abort())).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('runFind', () => {
  it('skips a set that cannot load, with its reason, and still runs the rest', async () => {
    const dead: HighlightSet = {
      id: setId({ kind: 'provider', provider: 'binance', symbol: 'BTCUSDT', timeframe: '1h' }),
      version: 1,
      source: { kind: 'provider', provider: 'binance', symbol: 'BTCUSDT', timeframe: '1h' },
      trades,
      updatedAt: 1,
    };
    const stages: string[] = [];
    const r = await runFind({
      sets: [dead, csvSet('ok.csv')],
      inputs: inputs({ families: ['sma_cross'] }),
      loaders,
      onProgress: (_p, s) => stages.push(s),
    });
    expect(r.skippedSets).toEqual([{ label: 'binance - BTCUSDT - 1h', reason: 'no network for BTCUSDT' }]);
    expect(r.seriesLabels).toEqual(['ok.csv']);
    expect(r.outcome.kind).toBe('ok');
    expect(stages[0]).toBe('Loading data');
  }, 120_000);

  it('refuses in words when no set loads', async () => {
    const lib: HighlightSet = { id: 'library|x', version: 1, source: { kind: 'library', datasetId: 'x' }, trades, updatedAt: 1 };
    const r = await runFind({ sets: [lib], inputs: inputs(), loaders });
    expect(r.outcome).toMatchObject({ kind: 'refused' });
    expect(r.skippedSets[0].reason).toBe('no dataset x');
  });

  it('rejects with an AbortError when aborted while loading', async () => {
    const ctl = new AbortController();
    const slow: Loaders = { ...loaders, library: () => (ctl.abort(), { ok: true, candles, label: 'x' }) };
    const lib: HighlightSet = { id: 'library|x', version: 1, source: { kind: 'library', datasetId: 'x' }, trades, updatedAt: 1 };
    await expect(runFind({ sets: [lib], inputs: inputs(), loaders: slow, signal: ctl.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('loadSeries and tradesOf', () => {
  it('names a csv set whose candles were not kept', async () => {
    const r = await loadSeries([{ ...csvSet('a.csv'), candles: undefined }], loaders);
    expect(r.series).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/not kept/);
  });
  it('gives the trades a candidate takes on the candles', () => {
    const t = tradesOf(candles.slice(0, 2000), 'sma_cross', { fast: 8, slow: 34, direction: 1 }, inputs());
    expect(t.length).toBeGreaterThan(5);
    expect(t.every((x) => x.side === 'long' && x.exitTime >= x.entryTime && x.entryPrice > 0)).toBe(true);
  });
});
