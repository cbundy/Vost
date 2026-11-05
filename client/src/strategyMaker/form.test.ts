import { describe, expect, it } from 'vitest';
import { blocker, defaultForm, readForm, sanitizeForm } from './form';

describe('find form', () => {
  it('starts with the main backtester risk defaults, every family and no targets', () => {
    const { inputs, errors } = readForm(defaultForm());
    expect(errors).toEqual({});
    expect(inputs.direction).toBe('both');
    expect(inputs.families).toHaveLength(6);
    expect(inputs.risk).toEqual({ feeBps: 10, slippageBps: 5, stopLossPct: null, takeProfitPct: null });
    expect(inputs.targets).toEqual({});
  });
  it('reads numbers; an empty stop, take profit or target is not applied', () => {
    const f = { ...defaultForm(), stopLossPct: '2.5', minRR: '1.5', maxDrawdownPct: ' 20 ' };
    const { inputs, errors } = readForm(f);
    expect(errors).toEqual({});
    expect(inputs.risk.stopLossPct).toBe(2.5);
    expect(inputs.risk.takeProfitPct).toBeNull();
    expect(inputs.targets).toEqual({ minRR: 1.5, maxDrawdownPct: 20 });
  });
  it('gives a message per bad number', () => {
    const { errors } = readForm({ ...defaultForm(), feeBps: 'abc', slippageBps: '', stopLossPct: '0', minHitRatePct: '101', minRR: '-1' });
    expect(Object.keys(errors).sort()).toEqual(['feeBps', 'minHitRatePct', 'minRR', 'slippageBps', 'stopLossPct']);
    expect(errors.feeBps).toMatch(/number/);
  });
  it('blocks Find with a reason', () => {
    expect(blocker({ feeBps: 'x' }, ['sma_cross'], 40)).toMatch(/Fix the numbers/);
    expect(blocker({}, [], 40)).toMatch(/at least one/);
    expect(blocker({}, ['sma_cross'], 29)).toBe('1 more trade needed (29 of 30).');
    expect(blocker({}, ['sma_cross'], 28)).toMatch(/^2 more trades needed/);
    expect(blocker({}, ['sma_cross'], 30)).toBeNull();
  });
  it('sanitizes stored junk to defaults', () => {
    expect(sanitizeForm(null)).toEqual(defaultForm());
    const s = sanitizeForm({ direction: 'sideways', families: ['sma_cross', 'nope'], feeBps: 7, minRR: '2', setIds: ['a', 3] });
    expect(s.direction).toBe('both');
    expect(s.families).toEqual(['sma_cross']);
    expect(s.feeBps).toBe('10');
    expect(s.minRR).toBe('2');
    expect(s.setIds).toEqual(['a']);
  });
});
