import { describe, expect, it } from 'vitest';
import { computeMetrics } from './metrics';
import type { EquityPoint } from './types';

const H = 3600;
const T0 = 1700000000;

/** Equity points at the given times; a null level means a new high, a number is the drawdown percent. */
function points(times: number[], dd: number[]): EquityPoint[] {
  return times.map((time, i) => ({ time, equity: 10000, drawdownPct: dd[i], position: 0 }));
}
const hourly = (n: number) => Array.from({ length: n }, (_, i) => T0 + i * H);
const run = (eq: EquityPoint[]) => computeMetrics([], eq, [], 10000, 0);

describe('max drawdown duration', () => {
  it('measures the longest stretch in bars and clock seconds', () => {
    // peak at idx 1, underwater idx 2-6 (5 bars), recovery, then 2 underwater bars
    const eq = points(hourly(11), [0, 0, -1, -2, -3, -2, -1, 0, -1, -1, 0]);
    const m = run(eq);
    expect(m.maxDrawdownBars).toBe(5);
    expect(m.maxDrawdownSeconds).toBe(5 * H);
  });

  it('counts a weekend-sized gap inside the stretch as clock time', () => {
    const times = hourly(11);
    for (let i = 4; i < times.length; i++) times[i] += 48 * H;
    const m = run(points(times, [0, 0, -1, -2, -3, -2, -1, 0, -1, -1, 0]));
    expect(m.maxDrawdownBars).toBe(5);
    expect(m.maxDrawdownSeconds).toBe(53 * H);
  });

  it('is 0 and 0 without a drawdown', () => {
    const m = run(points(hourly(4), [0, 0, 0, 0]));
    expect(m.maxDrawdownBars).toBe(0);
    expect(m.maxDrawdownSeconds).toBe(0);
  });

  it('measures from the first bar when the run starts underwater', () => {
    const m = run(points(hourly(5), [-1, -2, -1, 0, 0]));
    expect(m.maxDrawdownBars).toBe(3);
    expect(m.maxDrawdownSeconds).toBe(2 * H);
  });

  it('keeps the first of two equally long stretches', () => {
    const times = hourly(8);
    times[6] += 10 * H;
    times[7] += 10 * H;
    const m = run(points(times, [0, -1, -1, 0, 0, -1, -1, 0]));
    expect(m.maxDrawdownBars).toBe(2);
    expect(m.maxDrawdownSeconds).toBe(2 * H);
  });
});
