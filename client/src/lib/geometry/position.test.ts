import { describe, expect, it } from 'vitest';
import { formatMoney, positionOutcome, positionStats, quantityFor, riskAmount, sidesValid, type PositionInputs } from './position';

const inputs = (o: Partial<PositionInputs> = {}): PositionInputs => ({ accountSize: 1000, lotSize: 1, risk: 25, riskUnit: 'percent', ...o });
const bar = (time: number, high: number, low: number) => ({ time, open: (high + low) / 2, high, low, close: (high + low) / 2 });

describe('risk and quantity', () => {
  it('takes a percent of the account or the amount', () => {
    expect(riskAmount(inputs())).toBe(250);
    expect(riskAmount(inputs({ riskUnit: 'amount', risk: 40 }))).toBe(40);
    expect(riskAmount(inputs({ accountSize: 12345.67, risk: 1.5 }))).toBe(185.18505);
  });
  it('rounds the quantity down so the risk is never exceeded', () => {
    // 250 / 3 = 83.33
    expect(quantityFor(250, 3, 1)).toBe(83);
    expect(83 * 3).toBeLessThanOrEqual(250);
    expect(quantityFor(250, 3.01, 1)).toBe(83);
    expect(quantityFor(2, 3, 1)).toBe(0);
  });
  it('divides by the lot size as well', () => {
    expect(quantityFor(250, 2, 10)).toBe(12); // 250 / 20
    expect(quantityFor(250, 2, 0.5)).toBe(250); // 250 / 1
  });
  it('is zero when the stop sits on the entry or there is no risk', () => {
    expect(quantityFor(250, 0, 1)).toBe(0);
    expect(quantityFor(0, 5, 1)).toBe(0);
  });
  it('is not pushed down a unit by float error (0.3 - 0.2)', () => {
    expect(0.3 - 0.2).not.toBe(0.1);
    const s = positionStats({ entry: 0.3, target: 0.5, stop: 0.2 }, inputs({ riskUnit: 'amount', risk: 250 }));
    expect(s.stopDistance).toBe(0.1);
    expect(s.quantity).toBe(2500);
  });
});

describe('position statistics', () => {
  const prices = { entry: 100, target: 110, stop: 96 };
  it('computes distances, percent, profit or loss and risk/reward', () => {
    const s = positionStats(prices, inputs(), 0.01);
    expect(s.riskAmount).toBe(250);
    expect(s.quantity).toBe(62); // 250 / 4 = 62.5
    expect(s.targetDistance).toBe(10);
    expect(s.stopDistance).toBe(4);
    expect(s.targetPct).toBe(10);
    expect(s.stopPct).toBe(4);
    expect(s.targetPnl).toBe(620);
    expect(s.stopPnl).toBe(-248);
    expect(s.riskReward).toBe(2.5);
  });
  it('multiplies by the lot size', () => {
    const s = positionStats(prices, inputs({ lotSize: 10 }));
    expect(s.quantity).toBe(6); // 250 / 40
    expect(s.targetPnl).toBe(600);
    expect(s.stopPnl).toBe(-240);
  });
  it('mirrors for a short (same distances)', () => {
    const s = positionStats({ entry: 100, target: 90, stop: 104 }, inputs());
    expect(s.targetDistance).toBe(10);
    expect(s.stopDistance).toBe(4);
    expect(s.targetPnl).toBe(620);
  });
  it('counts whole ticks with tick sizes 0.01 and 0.00001', () => {
    const a = positionStats({ entry: 1.1, target: 1.3, stop: 1.07 }, inputs(), 0.01);
    expect([a.targetTicks, a.stopTicks]).toEqual([20, 3]);
    const b = positionStats({ entry: 1.10001, target: 1.10031, stop: 1.09976 }, inputs(), 0.00001);
    expect([b.targetTicks, b.stopTicks]).toEqual([30, 25]);
  });
  it('leaves the ticks out without a tick size', () => {
    const s = positionStats(prices, inputs());
    expect(s.targetTicks).toBeUndefined();
    expect('stopTicks' in s).toBe(false);
  });
  it('has no risk/reward when the stop is on the entry', () => {
    expect(positionStats({ entry: 5, target: 6, stop: 5 }, inputs()).riskReward).toBeNull();
  });
  it('is exact for entry 0.2 with target 0.3 and stop 0.1', () => {
    const s = positionStats({ entry: 0.2, target: 0.3, stop: 0.1 }, inputs({ riskUnit: 'amount', risk: 100 }), 0.01);
    expect(s.targetDistance).toBe(0.1);
    expect(s.stopDistance).toBe(0.1);
    expect(s.targetTicks).toBe(10);
    expect(s.quantity).toBe(1000);
    expect(s.targetPnl).toBe(100);
    expect(s.stopPnl).toBe(-100);
    expect(s.riskReward).toBe(1);
  });
});

describe('sides', () => {
  it('needs the target above and the stop below a long entry, and the mirror for a short', () => {
    expect(sidesValid('long', { entry: 10, target: 12, stop: 9 })).toBe(true);
    expect(sidesValid('long', { entry: 10, target: 9, stop: 8 })).toBe(false);
    expect(sidesValid('long', { entry: 10, target: 10, stop: 9 })).toBe(false);
    expect(sidesValid('short', { entry: 10, target: 8, stop: 11 })).toBe(true);
    expect(sidesValid('short', { entry: 10, target: 12, stop: 11 })).toBe(false);
    expect(sidesValid('long', { entry: NaN, target: 12, stop: 9 })).toBe(false);
  });
});

describe('outcome', () => {
  const long = { entry: 100, target: 110, stop: 95 };
  it('is the target when a later bar reaches it first', () => {
    const bars = [bar(1, 101, 99), bar(2, 105, 98), bar(3, 111, 100), bar(4, 100, 90)];
    expect(positionOutcome('long', long, 1, 10, bars)).toEqual({ result: 'target', time: 3, price: 110 });
  });
  it('is the stop when a later bar reaches it first', () => {
    const bars = [bar(1, 101, 99), bar(2, 105, 94), bar(3, 115, 100)];
    expect(positionOutcome('long', long, 1, 10, bars)).toEqual({ result: 'stop', time: 2, price: 95 });
  });
  it('counts a bar that reaches both as the stop', () => {
    expect(positionOutcome('long', long, 1, 10, [bar(2, 112, 94)])).toEqual({ result: 'stop', time: 2, price: 95 });
  });
  it('ignores the entry bar and bars after the end time', () => {
    const bars = [bar(1, 200, 0), bar(2, 105, 99), bar(5, 120, 100)];
    expect(positionOutcome('long', long, 1, 4, bars)).toEqual({ result: 'open' });
    expect(positionOutcome('long', long, 1, 5, bars).result).toBe('target');
  });
  it('mirrors for a short', () => {
    const short = { entry: 100, target: 90, stop: 105 };
    expect(positionOutcome('short', short, 0, 9, [bar(1, 101, 89)])).toEqual({ result: 'target', time: 1, price: 90 });
    expect(positionOutcome('short', short, 0, 9, [bar(1, 106, 99)])).toEqual({ result: 'stop', time: 1, price: 105 });
    expect(positionOutcome('short', short, 0, 9, [bar(1, 106, 89)]).result).toBe('stop');
  });
  it('is open with no bars, one bar that reaches neither, or an end time before any bar', () => {
    expect(positionOutcome('long', long, 1, 10, [])).toEqual({ result: 'open' });
    expect(positionOutcome('long', long, 1, 10, [bar(1, 101, 99)])).toEqual({ result: 'open' });
    expect(positionOutcome('long', long, 5, 6, [bar(7, 200, 0)])).toEqual({ result: 'open' });
    expect(positionOutcome('long', long, 5, 1, [bar(2, 200, 0)])).toEqual({ result: 'open' });
  });
});

describe('formatMoney', () => {
  it('uses two decimals and a sign', () => {
    expect(formatMoney(12.5)).toBe('+12.50');
    expect(formatMoney(-3)).toBe('-3.00');
    expect(formatMoney(0)).toBe('0.00');
    expect(formatMoney(-0.001)).toBe('0.00');
  });
});
