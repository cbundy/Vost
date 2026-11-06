import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { composeSignals } from './composed';
import { runFullBacktest } from './runner';
import { buildSignals, DEFAULT_PARAMS, getStrategy, visibleParams } from './strategies';
import { defaultBacktestConfig, type Signal } from './types';

const closesToCandles = (closes: number[], volumes?: number[]): Candle[] =>
  closes.map((c, i) => ({
    time: 1_600_000_000 + i * 86400,
    open: c,
    high: c + 1,
    low: c - 1,
    close: c,
    volume: volumes?.[i] ?? 100,
  }));

const N: null = null;

function wavy(n = 400, seed = 0): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + 20 * Math.sin((i + seed) / 9) + 8 * Math.sin((i + seed) / 3.1) + i * 0.05;
    return {
      time: 1_600_000_000 + i * 86400,
      open: c,
      high: c + 1 + (i % 5) * 0.3,
      low: c - 1 - (i % 3) * 0.3,
      close: c,
      volume: 1000 + ((i * 37) % 400),
    };
  });
}

describe('composed with every filter off', () => {
  const rules = [
    [1, 'sma_cross', ['fast', 'slow']],
    [2, 'ema_cross', ['fast', 'slow']],
    [3, 'macd_cross', ['fast', 'slow', 'signal']],
    [4, 'rsi_reversion', ['length', 'oversold', 'overbought']],
    [5, 'bollinger', ['length', 'mult', 'mode']],
    [6, 'donchian', ['entry', 'exit']],
  ] as const;
  const candles = wavy();
  for (const [rule, id, keys] of rules) {
    for (const direction of [1, 2, 3]) {
      it(`equals ${id}, direction ${direction}`, () => {
        const composed: Record<string, number> = {
          ...DEFAULT_PARAMS.composed,
          entryRule: rule,
          direction,
        };
        const own = {
          direction,
          ...Object.fromEntries(keys.map((k) => [k, composed[k]])),
        };
        const expected = buildSignals(candles, id, own);
        expect(expected.some((s) => s === 1 || s === -1)).toBe(true);
        expect(buildSignals(candles, 'composed', composed)).toEqual(expected);
      });
    }
  }
  it('with the defaults equals ema_cross 12/26', () => {
    expect(buildSignals(candles, 'composed', DEFAULT_PARAMS.composed)).toEqual(
      buildSignals(candles, 'ema_cross', { fast: 12, slow: 26, direction: 1 }),
    );
  });
});

describe('composeSignals filters', () => {
  it('trend filter blocks entries on the wrong side, and a blocked run is not entered part-way', () => {
    const candles = closesToCandles([10, 10, 10, 12, 12, 9, 7, 9, 9, 11]);
    const entry: Signal[] = [N, 0, 1, 1, 0, -1, -1, 0, 1, 1];
    const { signals, filters } = composeSignals(candles, entry, {
      trendFilter: 1,
      trendLen: 2,
    });
    // i2: close 10 is not above its average 10 (blocked, and i3 does not enter part-way); i5: 9 < 10.5 passes; i8: 9 is not above 9.
    expect(signals).toEqual([N, 0, 0, 0, 0, -1, -1, 0, 0, 0]);
    expect(filters).toEqual({
      signals: 3,
      taken: 1,
      blocked: [{ key: 'trend', label: 'trend', blocked: 2 }],
    });
  });

  it('a direct flip closes the long and re-checks the filters for the short', () => {
    const entry: Signal[] = [N, 0, 1, 1, -1, -1, 0];
    const pass = composeSignals(closesToCandles([10, 10, 11, 12, 9, 9, 9]), entry, { trendFilter: 1, trendLen: 2 });
    expect(pass.signals).toEqual([N, 0, 1, 1, -1, -1, 0]);
    const veto = composeSignals(closesToCandles([10, 10, 11, 12, 13, 13, 13]), entry, { trendFilter: 1, trendLen: 2 });
    expect(veto.signals).toEqual([N, 0, 1, 1, 0, 0, 0]);
    expect(veto.filters.blocked[0].blocked).toBe(1);
  });

  it('volume filter needs volume >= multiple x the average (which includes the bar); an average of 0 blocks', () => {
    const candles = closesToCandles(new Array(7).fill(10), [10, 10, 20, 10, 10, 10, 40]);
    const entry: Signal[] = [N, 0, 1, 1, 0, 1, 1];
    const { signals, filters } = composeSignals(candles, entry, {
      volumeFilter: 1,
      volumeLen: 2,
      volumeMult: 1.2,
    });
    expect(signals).toEqual([N, 0, 1, 1, 0, 0, 0]);
    expect(filters).toEqual({
      signals: 2,
      taken: 1,
      blocked: [{ key: 'volume', label: 'volume', blocked: 1 }],
    });
    const zero = composeSignals(closesToCandles([10, 10, 10, 10], [0, 0, 0, 0]), [N, 0, 1, 1], {
      volumeFilter: 1,
      volumeLen: 2,
      volumeMult: 0,
    });
    expect(zero.signals).toEqual([N, 0, 0, 0]);
    expect(zero.filters.blocked[0].blocked).toBe(1);
  });

  it('volatility filter keeps ATR/close x 100 inside the band, edges included', () => {
    // close 100 with half-range h gives true range 2h, so ATR(1) is 2h and the percent is 2h.
    const half = [0.5, 0.5, 0.5, 0.5, 2.5, 0.5, 3, 0.5, 0.25, 0.5];
    const candles: Candle[] = half.map((h, i) => ({
      time: i,
      open: 100,
      high: 100 + h,
      low: 100 - h,
      close: 100,
      volume: 1,
    }));
    const entry: Signal[] = [N, 0, 1, 0, 1, 0, 1, 0, 1, 0];
    const { signals, filters } = composeSignals(candles, entry, {
      atrFilter: 1,
      atrLen: 1,
      atrMinPct: 1,
      atrMaxPct: 5,
    });
    // i2: 1% (lower edge, passes); i4: 5% (upper edge, passes); i6: 6% (blocked); i8: 0.5% (blocked)
    expect(signals).toEqual([N, 0, 1, 0, 1, 0, 0, 0, 0, 0]);
    expect(filters).toEqual({
      signals: 4,
      taken: 2,
      blocked: [{ key: 'volatility', label: 'volatility', blocked: 2 }],
    });
  });

  it('trend-strength filter needs ADX >= the minimum, and is null while ADX is undefined', () => {
    const H = [10, 11, 12, 11.5, 12.5, 13, 12.8, 13.5, 14, 13.2];
    const L = [9, 9.8, 10.5, 10.2, 11, 11.6, 11.5, 12, 12.9, 12.1];
    const C = [9.5, 10.8, 11.8, 10.8, 12.2, 12.9, 12.0, 13.4, 13.1, 12.4];
    const candles: Candle[] = C.map((close, i) => ({
      time: i,
      open: close,
      high: H[i],
      low: L[i],
      close,
      volume: 1,
    }));
    const entry: Signal[] = [0, 0, 0, 0, 0, 0, 1, 0, 1, 1];
    // ADX(3) from bar 5: 81.98, 79.91, 81.78, 84.48, 59.72
    const { signals, filters } = composeSignals(candles, entry, {
      adxFilter: 1,
      adxLen: 3,
      adxMin: 80,
    });
    expect(signals).toEqual([N, N, N, N, N, 0, 0, 0, 1, 1]);
    expect(filters).toEqual({
      signals: 2,
      taken: 1,
      blocked: [{ key: 'strength', label: 'strength', blocked: 1 }],
    });
  });

  it('a signal vetoed by two filters counts for both, and signals - taken counts it once', () => {
    const candles = closesToCandles([10, 10, 10, 12, 12, 9, 7, 9, 9, 11], new Array(10).fill(100));
    const entry: Signal[] = [N, 0, 1, 1, 0, -1, -1, 0, 1, 1];
    const { signals, filters } = composeSignals(candles, entry, {
      trendFilter: 1,
      trendLen: 2,
      volumeFilter: 1,
      volumeLen: 2,
      volumeMult: 2,
    });
    expect(signals).toEqual([N, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(filters.signals).toBe(3);
    expect(filters.taken).toBe(0);
    expect(filters.blocked.map((b) => [b.key, b.blocked])).toEqual([
      ['trend', 2],
      ['volume', 3],
    ]);
  });

  it('is null until every enabled filter has a value', () => {
    const candles = wavy(120);
    const params = { ...DEFAULT_PARAMS.composed, trendFilter: 1, trendLen: 50 };
    const out = buildSignals(candles, 'composed', params);
    expect(out.slice(0, 49).every((s) => s === null)).toBe(true);
    expect(out[49]).not.toBeNull();
  });

  it('never looks ahead: changing later bars leaves earlier outputs unchanged', () => {
    const candles = wavy(300);
    for (const entryRule of [2, 6]) {
      const params = {
        ...DEFAULT_PARAMS.composed,
        entryRule,
        direction: 3,
        fast: 5,
        slow: 20,
        entry: 15,
        exit: 8,
        trendFilter: 2,
        trendLen: 30,
        volumeFilter: 1,
        volumeLen: 10,
        volumeMult: 0.9,
        atrFilter: 1,
        atrMinPct: 0.1,
        atrMaxPct: 50,
        adxFilter: 1,
        adxLen: 7,
        adxMin: 10,
      };
      const full = buildSignals(candles, 'composed', params);
      expect(full.some((s) => s === 1)).toBe(true);
      for (const i of [60, 120, 200]) {
        const changed = candles.map((c, k) =>
          k <= i
            ? c
            : {
                ...c,
                open: c.open * 1.7,
                high: c.high * 1.9,
                low: c.low * 0.4,
                close: c.close * 0.6,
                volume: c.volume * 5,
              },
        );
        const part = buildSignals(changed, 'composed', params);
        expect(part.slice(0, i + 1)).toEqual(full.slice(0, i + 1));
      }
    }
  });
});

describe('composed in the runner and the settings view', () => {
  const candles = wavy(300);
  it('runFullBacktest returns the filter counts for composed only', () => {
    const cfg = {
      ...defaultBacktestConfig(),
      strategyId: 'composed',
      params: { ...DEFAULT_PARAMS.composed, trendFilter: 1, trendLen: 60 },
    };
    const res = runFullBacktest(candles, cfg);
    expect(res.filters?.signals).toBeGreaterThan(0);
    expect(res.filters?.blocked.map((b) => b.key)).toEqual(['trend']);
    expect(
      runFullBacktest(candles, {
        ...defaultBacktestConfig(),
        strategyId: 'sma_cross',
        params: { fast: 5, slow: 20, direction: 1 },
      }).filters,
    ).toBeUndefined();
  });

  it('visibleParams shows only the chosen entry rule and the enabled filters', () => {
    const s = getStrategy('composed');
    const keys = (p: Record<string, number>) => visibleParams(s, p).map((x) => x.key);
    expect(keys(DEFAULT_PARAMS.composed)).toEqual([
      'entryRule',
      'direction',
      'fast',
      'slow',
      'trendFilter',
      'volumeFilter',
      'atrFilter',
      'adxFilter',
    ]);
    expect(
      keys({
        ...DEFAULT_PARAMS.composed,
        entryRule: 6,
        trendFilter: 2,
        adxFilter: 1,
      }),
    ).toEqual([
      'entryRule',
      'direction',
      'entry',
      'exit',
      'trendFilter',
      'trendLen',
      'volumeFilter',
      'atrFilter',
      'adxFilter',
      'adxLen',
      'adxMin',
    ]);
    const sma = getStrategy('sma_cross');
    expect(visibleParams(sma, {}).length).toBe(sma.params.length);
  });
});
