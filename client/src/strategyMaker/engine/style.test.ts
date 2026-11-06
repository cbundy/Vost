import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../lib/random';
import type { Candle } from '../../types';
import { buildStyleReport, classifyTrades, countStyles, emptyCounts, leadingStyles, styleFamilies, SIGNAL_FAMILIES, type TradeStyleLabel } from './index';
import { synth } from './synthetic';

const T0 = 1_600_000_000;
const STEP = 3600;

/** Candles from closes; each bar's wicks reach `wick` (a share of the close) beyond its open and close. */
function bars(closes: number[], wick = 0.001): Candle[] {
  return closes.map((close, i) => {
    const open = i ? closes[i - 1] : close;
    return { time: T0 + i * STEP, open, high: Math.max(open, close) * (1 + wick), low: Math.min(open, close) * (1 - wick), close, volume: 1000 };
  });
}
/** `n` closes from `from` growing by `rate` a bar. */
const ramp = (from: number, rate: number, n: number): number[] => Array.from({ length: n }, (_, i) => from * (1 + rate) ** (i + 1));
const last = (a: number[]): number => a[a.length - 1];

function styleAt(candles: Candle[], bar: number, side: 'long' | 'short' = 'long'): { style: TradeStyleLabel; reason: string } {
  const t = classifyTrades([{ candles, trades: [{ side, entryTime: candles[bar].time, exitTime: candles[candles.length - 1].time }] }], 'both');
  expect(t).toHaveLength(1);
  return t[0];
}

describe('classifyTrades', () => {
  it('reads an entry at a fresh low inside a downtrend as a reversal', () => {
    const c = bars(ramp(200, -0.003, 320));
    const r = styleAt(c, 319);
    expect(r.style).toBe('reversal');
    expect(r.reason).toContain('lowest low');
  });

  it('prefers reversal to mean reversion when an entry fits both', () => {
    const closes = ramp(200, -0.003, 300);
    closes.push(...ramp(last(closes), -0.03, 3));
    const c = bars(closes);
    const r = styleAt(c, closes.length - 1);
    expect(r.style).toBe('reversal');
  });

  it('reads a long after a sharp drop in an uptrend as mean reversion', () => {
    const closes = ramp(100, 0.002, 300);
    closes.push(last(closes) * 0.93);
    const r = styleAt(bars(closes), closes.length - 1);
    expect(r.style).toBe('mean_reversion');
    expect(r.reason).toMatch(/standard deviations below|oversold/);
  });

  it('reads a short after a sharp rise in a downtrend as mean reversion', () => {
    const closes = ramp(200, -0.002, 300);
    closes.push(last(closes) * 1.07);
    expect(styleAt(bars(closes), closes.length - 1, 'short').style).toBe('mean_reversion');
  });

  it('reads a strong move with the slow trend as momentum', () => {
    const closes = ramp(100, 0.001, 300);
    closes.push(...ramp(last(closes), 0.01, 20));
    const r = styleAt(bars(closes), closes.length - 1);
    expect(r.style).toBe('momentum');
    expect(r.reason).toContain('ATR');
  });

  it('reads a close through the prior 20-bar range as a breakout', () => {
    const closes = ramp(100, 0.0003, 300);
    closes.push(last(closes) * 1.025);
    const r = styleAt(bars(closes, 0.01), closes.length - 1);
    expect(r.style).toBe('breakout');
    expect(r.reason).toContain('highest high');
  });

  it('reads a fresh fast-over-slow average cross as trend following', () => {
    // a long rise, a 40-bar dip under the 30-bar average, then a turn up that crosses 3 bars before entry (bar 346 of 349)
    const closes = ramp(100, 0.002, 300);
    closes.push(...ramp(last(closes), -0.0015, 40));
    closes.push(...ramp(last(closes), 0.005, 9));
    const c = bars(closes, 0.01);
    const r = styleAt(c, closes.length - 1);
    expect(r.style).toBe('trend');
    expect(r.reason).toContain('crossed above');
  });

  it('reads a small step back inside an uptrend as continuation', () => {
    const closes = ramp(100, 0.0005, 300);
    closes.push(...ramp(last(closes), -0.0008, 5));
    const r = styleAt(bars(closes, 0.01), closes.length - 1);
    expect(r.style).toBe('continuation');
  });

  it('labels an entry before the 200-bar average exists as unclear', () => {
    const c = bars(ramp(100, 0.002, 400));
    const r = styleAt(c, 100);
    expect(r.style).toBe('unclear');
    expect(r.reason).toContain('too early');
  });

  it('labels an entry that fits no rule as unclear', () => {
    // a flat range with a gentle wave: no stretch, no break, no cross, no trend
    const closes = Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 3) * 0.2);
    const labels = new Set<string>();
    for (let b = 250; b < 400; b++) labels.add(styleAt(bars(closes), b).style);
    expect(labels.has('unclear')).toBe(true);
  });

  it('reads only bars up to the entry: later bars change nothing', () => {
    const closes = ramp(100, 0.002, 320);
    const a = styleAt(bars(closes), 300);
    const more = [...closes.slice(0, 301), ...ramp(closes[300], -0.05, 40)];
    expect(styleAt(bars(more), 300)).toEqual(a);
  });

  it('skips trades the search skips', () => {
    const c = bars(ramp(100, 0.002, 400));
    const t = classifyTrades([{ candles: c, trades: [{ side: 'short', entryTime: c[300].time, exitTime: c[310].time }] }], 'long');
    expect(t).toEqual([]);
  });
});

describe('leading styles', () => {
  const counts = (o: Partial<Record<TradeStyleLabel, number>>) => ({ ...emptyCounts(), ...o });

  it('leaves no style leading for random entries on random-walk bars', () => {
    const candles = synth(6000, 77);
    const rand = mulberry32(5);
    const trades = Array.from({ length: 300 }, () => {
      const i = 250 + Math.floor(rand() * 5000);
      return { side: 'long' as const, entryTime: candles[i].time, exitTime: candles[i + 5].time };
    });
    const t = classifyTrades([{ candles, trades }], 'long');
    expect(t).toHaveLength(300);
    expect(leadingStyles(countStyles(t))).toEqual([]);
  });

  it('takes the top style plus those with at least half its count', () => {
    expect(leadingStyles(counts({ trend: 10, continuation: 5, breakout: 4, unclear: 3 }))).toEqual(['trend', 'continuation']);
  });

  it('needs the top style to hold 40% of the trades, counting unclear', () => {
    expect(leadingStyles(counts({ trend: 8, unclear: 13 }))).toEqual([]);
    expect(leadingStyles(counts({ trend: 8, unclear: 12 }))).toEqual(['trend']);
    expect(leadingStyles(emptyCounts())).toEqual([]);
  });
});

describe('styleFamilies', () => {
  it('keeps the allowed families that share a leading style', () => {
    const r = styleFamilies([...SIGNAL_FAMILIES], ['mean_reversion']);
    expect(r.applied).toBe(true);
    expect(r.families).toEqual(expect.arrayContaining(['rsi_reversion', 'bollinger']));
    expect(r.families).not.toContain('sma_cross');
  });

  it('falls back to every allowed family, with a note, when none match', () => {
    const r = styleFamilies(['sma_cross', 'ema_cross'], ['reversal']);
    expect(r).toMatchObject({ families: ['sma_cross', 'ema_cross'], applied: false });
    expect(r.note).toContain('None of the allowed families');
  });

  it('searches every allowed family when no style leads', () => {
    const r = styleFamilies(['sma_cross'], []);
    expect(r).toMatchObject({ families: ['sma_cross'], applied: false });
    expect(r.note).toContain('do not lean');
  });

  it('leaves the families alone when the style is not used', () => {
    const trades = [{ series: 0, index: 0, side: 'long' as const, entryTime: 1, style: 'trend' as const, reason: 'x' }];
    const r = buildStyleReport(trades, ['rsi_reversion', 'sma_cross'], false);
    expect(r.applied).toBe(false);
    expect(r.families).toEqual(['rsi_reversion', 'sma_cross']);
    expect(r.counts.trend).toBe(1);
  });
});
