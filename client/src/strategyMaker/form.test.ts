import { describe, expect, it } from 'vitest';
import { blocker, defaultForm, readForm, sanitizeForm } from './form';

describe('find form', () => {
  it('starts with the main backtester risk defaults, every family and no targets', () => {
    const { inputs, errors } = readForm(defaultForm());
    expect(errors).toEqual({});
    expect(inputs.direction).toBe('both');
    expect(inputs.families).toHaveLength(10);
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

describe('find form exits', () => {
  const d = defaultForm();
  it('starts with every exit option off', () => {
    expect(d).toMatchObject({ stopMode: 'pct', takeProfitMode: 'pct', trailMode: 'off', atrLength: '14', stopAtrMult: '', trailPct: '' });
    expect(Object.keys(readForm(d).inputs.risk).sort()).toEqual(['feeBps', 'slippageBps', 'stopLossPct', 'takeProfitPct']);
  });
  it('a form stored before the exits opens with them off, and an unknown mode reads as off', () => {
    const old: Record<string, unknown> = { ...d };
    for (const k of ['stopMode', 'stopAtrMult', 'takeProfitMode', 'takeProfitAtrMult', 'takeProfitR', 'trailMode', 'trailPct', 'trailAtrMult', 'atrLength']) delete old[k];
    expect(sanitizeForm(old)).toEqual(d);
    const bad = sanitizeForm({ ...d, stopMode: 'x', takeProfitMode: 'y', trailMode: 'z' });
    expect([bad.stopMode, bad.takeProfitMode, bad.trailMode]).toEqual(['pct', 'pct', 'off']);
  });
  it('puts the active mode in risk, with the percent null', () => {
    const f = { ...d, stopLossPct: '3', stopMode: 'atr' as const, stopAtrMult: '2', takeProfitMode: 'atr' as const, takeProfitAtrMult: '3', trailMode: 'pct' as const, trailPct: '1.5', atrLength: '20' };
    const { inputs, errors } = readForm(f);
    expect(errors).toEqual({});
    expect(inputs.risk).toEqual({
      feeBps: 10, slippageBps: 5, stopLossPct: null, takeProfitPct: null,
      stopMode: 'atr', stopAtrMult: 2, takeProfitMode: 'atr', takeProfitAtrMult: 3, trailMode: 'pct', trailPct: 1.5, atrLength: 20,
    });
  });
  it('leaves atrLength out when no ATR mode is on, even with junk in it', () => {
    const { inputs, errors } = readForm({ ...d, trailMode: 'pct', trailPct: '2', atrLength: '999' });
    expect(errors).toEqual({});
    expect(inputs.risk.atrLength).toBeUndefined();
    expect(inputs.risk.trailMode).toBe('pct');
  });
  it('gives one error per bad active field and ignores inactive ones', () => {
    expect(readForm({ ...d, stopMode: 'atr', stopAtrMult: '0' }).errors).toHaveProperty('stopAtrMult');
    expect(readForm({ ...d, stopMode: 'atr', stopAtrMult: '2', atrLength: '2.5' }).errors).toHaveProperty('atrLength');
    expect(readForm({ ...d, stopMode: 'atr', stopAtrMult: '2', atrLength: '501' }).errors).toHaveProperty('atrLength');
    expect(Object.keys(readForm({ ...d, trailMode: 'pct', trailPct: 'abc' }).errors)).toEqual(['trailPct']);
    expect(Object.keys(readForm({ ...d, trailMode: 'atr', trailAtrMult: '-1', atrLength: '14' }).errors)).toEqual(['trailAtrMult']);
    expect(readForm({ ...d, takeProfitMode: 'atr', takeProfitAtrMult: '0' }).errors).toHaveProperty('takeProfitAtrMult');
    expect(readForm({ ...d, stopAtrMult: 'junk', takeProfitAtrMult: '-3', takeProfitR: '-1', trailPct: 'abc', atrLength: 'x' }).errors).toEqual({});
  });
  it('refuses a times-the-stop target with no stop or trail, with the Backtest tab wording', () => {
    const r = { ...d, takeProfitMode: 'r' as const, takeProfitR: '2' };
    expect(readForm(r).errors.takeProfitR).toBe('A take profit in times the stop needs a stop loss or a trailing stop');
    expect(readForm({ ...r, takeProfitR: '-1' }).errors.takeProfitR).toMatch(/above 0/);
    expect(readForm({ ...r, stopLossPct: '2' }).errors).toEqual({});
    expect(readForm({ ...r, stopMode: 'atr', stopAtrMult: '2' }).errors).toEqual({});
    expect(readForm({ ...r, trailMode: 'pct', trailPct: '2' }).errors).toEqual({});
    expect(readForm({ ...r, stopLossPct: '2' }).inputs.risk).toMatchObject({ takeProfitMode: 'r', takeProfitR: 2, stopLossPct: 2 });
  });
});

describe('find form style choice', () => {
  const d = defaultForm();
  it('is on by default and goes into the inputs', () => {
    expect(d.useStyle).toBe(true);
    expect(readForm(d).inputs.useStyle).toBe(true);
    expect(readForm({ ...d, useStyle: false }).inputs.useStyle).toBe(false);
  });
  it('reads a form stored without it, or with a non-boolean, as on', () => {
    const old: Record<string, unknown> = { ...d };
    delete old.useStyle;
    expect(sanitizeForm(old)).toEqual(d);
    expect(sanitizeForm({ ...d, useStyle: 'no' }).useStyle).toBe(true);
    expect(sanitizeForm({ ...d, useStyle: false }).useStyle).toBe(false);
  });
});
