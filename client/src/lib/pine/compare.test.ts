import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compareSummary, describeCompare, defaultCompareState, formatSummary, loadCompareState, saveCompareState, savedPineScripts } from './compare';

const sum = (a: string, b: string) => {
  const s = compareSummary(a, b);
  return [s.differences, s.added, s.removed];
};

describe('compareSummary', () => {
  it('identical texts, including both empty', () => {
    expect(compareSummary('a\nb', 'a\nb').identical).toBe(true);
    const e = compareSummary('', '');
    expect(e.identical).toBe(true);
    expect(e.differences).toBe(0);
  });
  it('counts one changed, inserted and removed line', () => {
    expect(sum('a\nb\nc', 'a\nX\nc')).toEqual([1, 1, 1]);
    expect(sum('a\nb\nc', 'a\nb\nNEW\nc')).toEqual([1, 1, 0]);
    expect(sum('a\nb\nc', 'a\nc')).toEqual([1, 0, 1]);
  });
  it('counts a change at the first and last line', () => {
    expect(sum('a\nb\nc', 'X\nb\nc')).toEqual([1, 1, 1]);
    expect(sum('a\nb\nc', 'a\nb\nX')).toEqual([1, 1, 1]);
  });
  it('a trailing newline alone is a difference', () => {
    const s = compareSummary('a', 'a\n');
    expect(s.identical).toBe(false);
    expect(s.differences).toBe(1);
    // the library works in whole lines: line "a" becomes "a" plus an empty line
    expect([s.added, s.removed]).toEqual([2, 1]);
  });
  it('whitespace differences count', () => {
    expect(compareSummary('a b', 'a  b').identical).toBe(false);
  });
  it('two separated edits are 2 differences', () => {
    const a = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n');
    const b = a.replace('l1', 'X').replace('l8', 'Y');
    expect(sum(a, b)).toEqual([2, 2, 2]);
  });
  it('is approximate on large, mostly different inputs', () => {
    let seed = 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const gen = () => Array.from({ length: 300 }, () => Math.floor(rnd() * 1e6).toString(36)).join('\n');
    expect(compareSummary(gen(), gen()).approximate).toBe(true);
    expect(compareSummary('a\nb', 'a\nc').approximate).toBe(false);
  });
});

describe('formatSummary', () => {
  it('formats identical, singular and plural', () => {
    expect(formatSummary(compareSummary('a', 'a'), 'Code A')).toBe('Identical to Code A');
    expect(formatSummary(compareSummary('a\nb\nc', 'a\nX\nc'), 'Code A')).toBe('1 difference: +1 line, -1 line vs Code A');
    expect(formatSummary({ identical: false, differences: 2, added: 3, removed: 2, approximate: true }, 'Code B')).toBe(
      '2 differences: +3 lines, -2 lines vs Code B (approximate)',
    );
  });
});

describe('saved state', () => {
  let store: Record<string, string>;
  beforeEach(() => {
    store = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to defaults on missing or bad values', () => {
    expect(loadCompareState()).toEqual(defaultCompareState());
    const bad: unknown[] = [
      'x',
      7,
      null,
      { texts: ['a', 'b'], count: 2, reference: 0 },
      { texts: ['a', 'b', 'c', 1], count: 2, reference: 0 },
      { texts: ['', '', '', ''], count: 5, reference: 0 },
      { texts: ['', '', '', ''], count: 2, reference: 4 },
      { texts: ['', '', '', ''], count: '2', reference: 0 },
    ];
    for (const v of bad) {
      store['vost.compare.v1'] = JSON.stringify(v);
      expect(loadCompareState()).toEqual(defaultCompareState());
    }
    store['vost.compare.v1'] = '{not json';
    expect(loadCompareState()).toEqual(defaultCompareState());
  });
  it('round-trips a valid state', () => {
    const s = { texts: ['a', 'b', 'c', 'd'], count: 3, reference: 1 } as const;
    expect(saveCompareState({ ...s, texts: [...s.texts] })).toBe(true);
    expect(loadCompareState()).toEqual(s);
  });
  it('a failed save returns false and does not throw', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(saveCompareState(defaultCompareState())).toBe(false);
  });

  it('savedPineScripts lists only pine indicators with titles', () => {
    store['vost.prefs.v1'] = JSON.stringify({
      indicators: [
        { kind: 'sma' },
        { kind: 'pine', source: '//@version=6\nindicator("My Ind", overlay=true)\nplot(close)' },
        { kind: 'pine', source: "strategy(title='Strat X')" },
        { kind: 'pine', source: 'plot(close)' },
        null,
      ],
    });
    expect(savedPineScripts().map((s) => s.label)).toEqual(['My Ind', 'Strat X', 'Pine indicator 3']);
  });
  it('savedPineScripts is empty for missing or broken prefs and never writes', () => {
    expect(savedPineScripts()).toEqual([]);
    store['vost.prefs.v1'] = '{oops';
    expect(savedPineScripts()).toEqual([]);
    store['vost.prefs.v1'] = JSON.stringify({ indicators: 5 });
    expect(savedPineScripts()).toEqual([]);
    expect(Object.keys(store)).toEqual(['vost.prefs.v1']);
  });
});

describe('describeCompare', () => {
  it('says Empty for an empty compared text, even against an empty reference', () => {
    expect(describeCompare('a\nb', '', 'Code A')).toBe('Empty');
    expect(describeCompare('', '', 'Code A')).toBe('Empty');
  });
  it('otherwise formats the summary', () => {
    expect(describeCompare('a', 'a', 'Code A')).toBe('Identical to Code A');
    expect(describeCompare('', 'a', 'Code A')).toBe(formatSummary(compareSummary('', 'a'), 'Code A'));
  });
});
