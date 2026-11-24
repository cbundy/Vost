import { afterEach, describe, expect, it, vi } from 'vitest';
import { withPineSources } from './pineSources';
import type { SweepInput } from './sweep/types';

const stopRole = { indicatorId: 'st', name: 'Supertrend', inputs: {}, role: 'stop' as const, mode: 'at-entry' as const, rule: { type: 'level' as const, plot: 'Supertrend' } };
const base = (over: Partial<SweepInput> = {}): SweepInput => ({
  markets: [{ provider: 'yahoo', symbol: 'AAPL' }],
  timeframes: ['1d'],
  families: [],
  direction: 'long',
  targetSets: [{ minHitRatePct: 0 }],
  risk: { initialCapital: 1000, riskPct: 2, feeBps: 0, slippageBps: 0 },
  exits: { stopMults: [1], tpMults: [1], kinds: ['pine'], pineStop: stopRole },
  composed: { entryRules: [2], filters: [], trendTfs: [] },
  ...over,
});

const stubFetch = (sources: Record<string, string>) => {
  const f = vi.fn(async (url: string) => {
    const id = decodeURIComponent(url.split('/').pop()!);
    return id in sources ? new Response(JSON.stringify({ source: sources[id] })) : new Response('', { status: 404 });
  });
  vi.stubGlobal('fetch', f);
  return f;
};
afterEach(() => vi.unstubAllGlobals());

describe('withPineSources', () => {
  it("fetches the stop's source with no other indicator", async () => {
    const f = stubFetch({ st: 'SRC' });
    const out = await withPineSources(base());
    expect(f).toHaveBeenCalledTimes(1);
    expect(out.composed?.pineSources).toEqual({ st: 'SRC' });
  });

  it('fetches the stop and the roles together, each indicator once', async () => {
    const f = stubFetch({ st: 'SRC', ema: 'EMA' });
    const pine = [{ role: { indicatorId: 'ema', name: 'EMA', inputs: {}, role: 'entry' as const, rule: { type: 'cross' as const, a: { kind: 'close' as const }, b: { kind: 'close' as const } } }, ranges: [] }, { role: { ...stopRole, role: 'filter' as const, rule: { type: 'above' as const, a: { kind: 'close' as const }, b: { kind: 'close' as const } } }, ranges: [] }];
    const out = await withPineSources(base({ composed: { entryRules: [], filters: [], trendTfs: [], pine } }));
    expect(f).toHaveBeenCalledTimes(2);
    expect(out.composed?.pineSources).toEqual({ st: 'SRC', ema: 'EMA' });
  });

  it('fetches nothing without the kind, and leaves a gone indicator without a source', async () => {
    const f = stubFetch({});
    const noKind = base({ exits: { stopMults: [1], tpMults: [1], kinds: ['range'], pineStop: stopRole } });
    expect(await withPineSources(noKind)).toBe(noKind);
    expect(f).not.toHaveBeenCalled();
    expect((await withPineSources(base())).composed?.pineSources).toEqual({});
  });
});
