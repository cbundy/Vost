import { describe, expect, it } from 'vitest';
import { validParams } from '../engine/search';
import { COMPOSED_FILTERS, composedCount, composedSettings, composedWords, ENTRY_GRIDS, trendTfsOf } from './composedSpace';
import { MAX_SWEEP_COMBOS, sweepCombos } from './sweep';
import type { SweepComposed, SweepInput, SweepPineRole } from './types';

const all: SweepComposed = { entryRules: [1, 2, 3, 4, 5, 6], filters: [...COMPOSED_FILTERS], trendTfs: [2, 3, 4, 6, 8, 12, 24] };
const mixes: SweepComposed[] = [
  { entryRules: [2], filters: [], trendTfs: [] },
  { entryRules: [2], filters: ['trend'], trendTfs: [4] },
  { entryRules: [1, 3], filters: ['volume', 'adx'], trendTfs: [] },
  { entryRules: [4, 5, 6], filters: ['trend', 'atr'], trendTfs: [2, 4, 24] },
  all,
];

describe('composed settings', () => {
  it('every setting is valid for Composed and none repeats', () => {
    for (const c of mixes) {
      const list = composedSettings(c, '1d', 1);
      expect(list.length).toBeGreaterThan(0);
      const seen = new Set<string>();
      for (const s of list) {
        expect(s.strategyId).toBe('composed');
        expect(validParams('composed', s.params)).toBe(true);
        const key = JSON.stringify(s.params);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('each rule has 9 to 12 own settings', () => {
    for (const r of [1, 2, 3, 4, 5, 6]) {
      const n = composedCount({ entryRules: [r], filters: [], trendTfs: [] }, '1d');
      expect(n).toBeGreaterThanOrEqual(9);
      expect(n).toBeLessThanOrEqual(12);
      expect(ENTRY_GRIDS[r]).toBeDefined();
    }
  });

  it('a filter that is not picked stays at its default', () => {
    for (const s of composedSettings({ entryRules: [2], filters: ['trend'], trendTfs: [4] }, '1d', 1)) {
      expect(s.params).toMatchObject({ volumeFilter: 0, atrFilter: 0, adxFilter: 0, volumeMult: 1, adxMin: 20 });
    }
  });

  it('tries each picked filter both off and on, with the brief\'s values', () => {
    const list = composedSettings({ entryRules: [2], filters: ['trend', 'volume', 'atr', 'adx'], trendTfs: [4] }, '1d', 1).map((s) => s.params);
    expect(list.some((p) => p.trendFilter === 0)).toBe(true);
    expect(new Set(list.filter((p) => p.trendFilter > 0).map((p) => `${p.trendFilter}|${p.trendLen}|${p.trendTf}`))).toEqual(
      new Set(['1|100|1', '1|200|1', '2|100|1', '2|200|1', '1|100|4', '1|200|4', '2|100|4', '2|200|4']),
    );
    expect(new Set(list.map((p) => p.volumeFilter))).toEqual(new Set([0, 1]));
    expect(list.filter((p) => p.volumeFilter === 1).every((p) => p.volumeMult === 1.5)).toBe(true);
    expect(list.filter((p) => p.adxFilter === 1).every((p) => p.adxMin === 25)).toBe(true);
    expect(list.every((p) => p.atrTf === 1)).toBe(true);
  });

  it('drops multiples above 1 on weekly bars', () => {
    const c: SweepComposed = { entryRules: [2], filters: ['trend'], trendTfs: [2, 4] };
    expect(trendTfsOf(c, '1w')).toEqual([1]);
    expect(trendTfsOf(c, '1d')).toEqual([1, 2, 4]);
    expect(composedSettings(c, '1w', 1).every((s) => s.params.trendTf === 1)).toBe(true);
    expect(composedCount(c, '1w')).toBeLessThan(composedCount(c, '1d'));
  });

  it('1 is always included and unknown multiples are left out', () => {
    expect(trendTfsOf({ entryRules: [2], filters: ['trend'], trendTfs: [] }, '1h')).toEqual([1]);
    expect(trendTfsOf({ entryRules: [2], filters: ['trend'], trendTfs: [5, 4] }, '1h')).toEqual([1, 4]);
  });

  it('the fast count equals the length of the built list', () => {
    for (const c of mixes) {
      for (const tf of ['1d', '1w', '15m'] as const) expect(composedCount(c, tf)).toBe(composedSettings(c, tf, 1).length);
    }
    expect(composedCount(undefined, '1d')).toBe(0);
    expect(composedCount({ entryRules: [], filters: ['trend'], trendTfs: [] }, '1d')).toBe(0);
    expect(composedSettings({ entryRules: [], filters: ['trend'], trendTfs: [] }, '1d', 1)).toEqual([]);
  });

  it('carries the direction of the search', () => {
    expect(composedSettings(mixes[0], '1d', 3).every((s) => s.params.direction === 3)).toBe(true);
  });

  it('counts the largest form that stays under the limit in under 50 ms', () => {
    const input = (markets: number): SweepInput => ({
      markets: Array.from({ length: markets }, (_, i) => ({ provider: 'p', symbol: `S${i}` })),
      timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
      families: ['macd_cross', 'sma_cross', 'ema_cross', 'rsi_reversion', 'bollinger', 'donchian'],
      direction: 'both',
      targetSets: [{ minHitRatePct: 50 }],
      risk: { initialCapital: 1000, riskPct: 2, feeBps: 10, slippageBps: 5 },
      exits: { stopMults: [1], tpMults: [1] },
      composed: all,
      baseline: true,
    });
    let markets = 1;
    while (sweepCombos(input(markets + 1)) <= MAX_SWEEP_COMBOS) markets++;
    const t0 = performance.now();
    const n = sweepCombos(input(markets));
    expect(performance.now() - t0).toBeLessThan(50);
    expect(n).toBeLessThanOrEqual(MAX_SWEEP_COMBOS);
    expect(sweepCombos(input(markets + 1))).toBeGreaterThan(MAX_SWEEP_COMBOS);
  });
});

describe('composed words', () => {
  const p = { entryRule: 2, direction: 1, fast: 10, slow: 40, trendFilter: 2, trendLen: 200, trendTf: 4, adxFilter: 1, adxMin: 25, volumeFilter: 0, atrFilter: 0 };
  it('names the rule, its settings and only the filters that are on', () => {
    expect(composedWords(p)).toBe('EMA crossover fast 10, slow 40; trend EMA 200 on 4x bars; ADX 25 or more');
  });
  it('words the volume and volatility filters and the loaded-bars trend', () => {
    expect(composedWords({ ...p, trendTf: 1, adxFilter: 0, volumeFilter: 1, volumeMult: 1.5, volumeLen: 20, atrFilter: 1, atrMinPct: 0.5, atrMaxPct: 5 })).toBe(
      'EMA crossover fast 10, slow 40; trend EMA 200; volume 1.5x its 20-bar average; ATR 0.5 to 5% of close',
    );
    expect(composedWords({ entryRule: 5, length: 20, mult: 2, mode: 1 })).toBe('Bollinger bands length 20, std dev 2, mode reversion');
  });
});

describe('composed settings with TradingView indicators', () => {
  const cross = { type: 'cross', a: { kind: 'close' }, b: { kind: 'plot', plot: 'EMA' } } as const;
  const above = { type: 'above', a: { kind: 'close' }, b: { kind: 'plot', plot: 'EMA' } } as const;
  const len = (from: number, to: number, step: number) => ({ input: 'length', from, to, step });
  const entry = (id: string, ranges = [len(10, 30, 10)]): SweepPineRole => ({ role: { indicatorId: id, name: `Ind ${id}`, inputs: {}, role: 'entry', rule: cross }, ranges });
  const filter = (id: string, ranges = [len(10, 20, 10)]): SweepPineRole => ({ role: { indicatorId: id, name: `Ind ${id}`, inputs: {}, role: 'filter', label: 'trend', rule: above }, ranges });
  const mixes: SweepComposed[] = [
    { entryRules: [], filters: [], trendTfs: [], pine: [entry('a')] },
    { entryRules: [2], filters: ['trend'], trendTfs: [4], pine: [filter('b')] },
    { entryRules: [1, 3], filters: ['volume'], trendTfs: [], pine: [entry('a'), entry('c', []), filter('b'), filter('d', [])] },
    { ...all, pine: [entry('a'), entry('b'), filter('c'), filter('d'), filter('e')] },
  ];

  it('the count equals the settings built, on 1d and 1w', () => {
    for (const c of mixes) {
      for (const tf of ['1d', '1w'] as const) {
        expect(composedCount(c, tf)).toBe(composedSettings(c, tf, 1).length);
        expect(composedCount(c, tf)).toBeGreaterThan(0);
      }
    }
  });

  it('adds M x the filter cross settings for each Pine entry, and (1 + M) per Pine filter', () => {
    // An entry with 3 input settings and a filter with 2: 3 x (1 + 2).
    expect(composedCount({ entryRules: [], filters: [], trendTfs: [], pine: [entry('a'), filter('b')] }, '1d')).toBe(3 * 3);
    // A rule 2 grid is 9 settings; the same filter multiplies it by 3 and the entry adds 3 x 3.
    const rule = composedCount({ entryRules: [2], filters: [], trendTfs: [] }, '1d');
    expect(composedCount({ entryRules: [2], filters: [], trendTfs: [], pine: [entry('a'), filter('b')] }, '1d')).toBe(rule * 3 + 9);
  });

  it('every setting is valid for Composed and for the role limits, and none repeats', async () => {
    const { validatePineRoles } = await import('../../lib/backtest/pineRole');
    // The last mix (every rule and filter) is left out here: it builds hundreds of thousands of settings.
    for (const c of mixes.slice(0, 3)) {
      const seen = new Set<string>();
      for (const s of composedSettings(c, '1d', 3)) {
        expect(validParams('composed', s.params)).toBe(true);
        const roles = validatePineRoles(s.pineRoles);
        expect(JSON.stringify(roles)).not.toContain('source');
        // Only a Pine entry setting has the TradingView entry rule, and it always has its entry role.
        expect(s.params.entryRule === 7).toBe(roles.some((r) => r.role === 'entry'));
        const key = JSON.stringify([s.params, s.pineRoles]);
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it('a search without Pine builds the settings it always did', () => {
    for (const c of mixes.map(({ pine: _p, ...rest }) => rest)) {
      for (const s of composedSettings(c, '1d', 1)) expect(s).not.toHaveProperty('pineRoles');
    }
    expect(composedSettings({ ...all, pine: [] }, '1d', 1)).toEqual(composedSettings(all, '1d', 1));
  });

  it('puts the range values over the fixed inputs of each setting', () => {
    const list = composedSettings({ entryRules: [], filters: [], trendTfs: [], pine: [entry('a')] }, '1d', 1);
    expect(list.map((s) => s.pineRoles?.[0].inputs)).toEqual([{ length: 10 }, { length: 20 }, { length: 30 }]);
    expect(list.every((s) => s.params.entryRule === 7)).toBe(true);
  });

  it('words name the indicator, the plot and the input values', () => {
    const [s] = composedSettings({ entryRules: [], filters: ['trend'], trendTfs: [], pine: [entry('a')] }, '1d', 1).filter((x) => x.params.trendFilter === 1);
    expect(composedWords(s.params, s.pineRoles)).toBe('TradingView "Ind a" close crosses EMA, length 10; trend SMA 100');
    const withFilter = composedSettings({ entryRules: [2], filters: [], trendTfs: [], pine: [filter('b')] }, '1d', 1).find((x) => x.pineRoles);
    expect(composedWords(withFilter!.params, withFilter!.pineRoles)).toMatch(/^EMA crossover fast \d+, slow \d+; TradingView filter "Ind b" \(trend\) close above EMA, length 10$/);
  });
});
