import { describe, expect, it } from 'vitest';
import type { Candle } from '../../types';
import { buildSignals, getStrategy, STRATEGY_STYLES, stylesOf, type StrategyStyle } from './strategies';

const bar = (i: number, close: number, o: Partial<Candle> = {}): Candle => ({
  time: 1_600_000_000 + i * 86400,
  open: close,
  high: close + 0.1,
  low: close - 0.1,
  close,
  volume: 1000,
  ...o,
});
const fromCloses = (closes: number[]): Candle[] => closes.map((c, i) => bar(i, c));

describe('pullback', () => {
  // a long uptrend, a sharp dip (RSI falls below 40), a recovery, then a trend break
  const up = Array.from({ length: 30 }, (_, i) => 100 + i * 2);
  const dipDown = [155, 150, 145, 141];
  const recover = [150, 158, 166];
  const p = { trend: 10, length: 5, dip: 40, target: 70 };
  const closes = [...up, ...dipDown, ...recover, 175, 185, 195];
  it('enters long only on the RSI cross back up inside the trend, exits above the target', () => {
    const s = buildSignals(fromCloses(closes), 'pullback', { ...p, direction: 1 });
    const entry = s.findIndex((v) => v === 1);
    expect(entry).toBeGreaterThan(up.length); // not during the straight rise
    expect(s[entry - 1]).toBe(0);
    const exit = s.findIndex((v, i) => i > entry && v === 0);
    expect(exit).toBeGreaterThan(entry);
  });
  it('exits when the close drops under the trend EMA', () => {
    const crash = [...closes, 120, 110];
    const s = buildSignals(fromCloses(crash), 'pullback', { ...p, target: 99, direction: 1 });
    const last = s[s.length - 1];
    expect(last).toBe(0);
    expect(s.some((v) => v === 1)).toBe(true);
  });
  it('shorts the mirror image', () => {
    const mirrored = closes.map((c) => 400 - c);
    const s = buildSignals(fromCloses(mirrored), 'pullback', { ...p, direction: 2 });
    expect(s.some((v) => v === -1)).toBe(true);
    expect(s.some((v) => v === 1)).toBe(false);
  });
  it('is null until the EMA and RSI exist', () => {
    const s = buildSignals(fromCloses(closes), 'pullback', { ...p, direction: 3 });
    expect(s.slice(0, 9).every((v) => v === null)).toBe(true);
  });
});

describe('reversal', () => {
  const calm = Array.from({ length: 25 }, (_, i) => 100 + (i % 2 === 0 ? 0.3 : -0.3));
  const closes = [...calm, 90, 99.5, 100.5, 101]; // 90 is far below the lower band, 99.5 back inside
  const p = { length: 20, mult: 2, direction: 1 };
  it('does not enter on the bar beyond the band, enters on the close back inside, exits past the middle', () => {
    const s = buildSignals(fromCloses(closes), 'reversal', p);
    const beyond = calm.length;
    expect(s[beyond]).toBe(0);
    expect(s[beyond + 1]).toBe(1);
    const exit = s.findIndex((v, i) => i > beyond + 1 && v === 0);
    expect(exit).toBeGreaterThan(beyond + 1);
  });
  it('mirrors for shorts with the upper band', () => {
    const s = buildSignals(fromCloses(closes.map((c) => 200 - c)), 'reversal', { ...p, direction: 2 });
    expect(s[calm.length]).toBe(0);
    expect(s[calm.length + 1]).toBe(-1);
  });
});

describe('momentum_breakout', () => {
  const flat = Array.from({ length: 30 }, (_, i) => 100 + (i % 2) * 0.2);
  const candles = (breakVolume: number): Candle[] => [...flat.map((c, i) => bar(i, c)), bar(30, 110, { volume: breakVolume }), bar(31, 111, { volume: 1000 })];
  const p = { entry: 10, exit: 5, volLen: 10, volMult: 1.5, direction: 1 };
  it('ignores a high break on low volume', () => {
    const s = buildSignals(candles(1200), 'momentum_breakout', p);
    expect(s.every((v) => v !== 1)).toBe(true);
  });
  it('enters on a high break with volume at least k times the prior average', () => {
    const s = buildSignals(candles(1500), 'momentum_breakout', p);
    expect(s[30]).toBe(1);
  });
  it('exits on a new low and enters short on the mirror', () => {
    const c = candles(1500);
    c.push(bar(32, 90, { volume: 3000 }));
    const s = buildSignals(c, 'momentum_breakout', { ...p, direction: 3 });
    expect(s[30]).toBe(1);
    expect(s[32]).toBe(-1);
  });
  it('averages only the bars before the signal bar', () => {
    // with its own volume included the average would be 1000 + (4000-1000)/10 = 1300, so 1500 >= 1.5*1300 would fail
    const s = buildSignals(candles(1500), 'momentum_breakout', p);
    expect(s[30]).toBe(1);
  });
});

describe('no look-ahead', () => {
  it('changing the next bar never changes the signal at a bar', () => {
    const base = Array.from({ length: 80 }, (_, i) => bar(i, 100 + 10 * Math.sin(i / 4) + i * 0.1, { volume: 1000 + (i % 9) * 300 }));
    for (const id of ['pullback', 'reversal', 'momentum_breakout']) {
      const params = { ...Object.fromEntries(getStrategy(id).params.map((q) => [q.key, q.default])), direction: 3 };
      const small = id === 'pullback' ? { ...params, trend: 10 } : { ...params, length: 10, entry: 10, exit: 5, volLen: 10 };
      const ref = buildSignals(base, id, small);
      for (let i = 20; i < 79; i += 7) {
        const alt = base.map((c, j) => (j === i + 1 ? { ...c, close: c.close * 1.3, high: c.high * 1.3, volume: c.volume * 9 } : c));
        expect(buildSignals(alt, id, small)[i]).toBe(ref[i]);
      }
    }
  });
});

describe('style table', () => {
  it('gives every searchable family a style and uses every style', () => {
    for (const id of ['sma_cross', 'ema_cross', 'macd_cross', 'rsi_reversion', 'bollinger', 'donchian', 'pullback', 'reversal', 'momentum_breakout']) expect(stylesOf(id).length).toBeGreaterThan(0);
    const used = new Set<StrategyStyle>(Object.values(STRATEGY_STYLES).flat());
    expect([...used].sort()).toEqual(['breakout', 'continuation', 'mean_reversion', 'momentum', 'reversal', 'trend']);
  });
  it('lists the primary style first', () => {
    expect(stylesOf('bollinger')).toEqual(['breakout', 'mean_reversion']);
    expect(stylesOf('pullback')).toEqual(['continuation', 'trend']);
    expect(stylesOf('nope')).toEqual([]);
  });
  it('has no param named mode in the new families', () => {
    for (const id of ['pullback', 'reversal', 'momentum_breakout']) expect(getStrategy(id).params.some((q) => q.key === 'mode')).toBe(false);
  });
});
