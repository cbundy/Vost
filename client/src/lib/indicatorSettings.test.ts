import { describe, expect, it } from 'vitest';
import { defaultIndicator } from './indicatorCompute';
import { cleanIndicatorDefault, indicatorDrawn, indicatorShortName, resetIndicator, sanitizeHideOn, sanitizeIndicatorDefaults, sanitizeIndicatorSpecs } from './indicatorSettings';

describe('sanitizeHideOn', () => {
  it('keeps known kinds once, in order, and drops everything else', () => {
    expect(sanitizeHideOn(['hours', 'minutes', 'minutes', 'years', 3, null])).toEqual(['minutes', 'hours']);
    for (const bad of [undefined, null, 'minutes', 5, {}, []]) expect(sanitizeHideOn(bad)).toEqual([]);
  });
});

describe('sanitizeIndicatorSpecs', () => {
  it('removes an empty or garbage hideOn and leaves other specs and non-objects alone', () => {
    const plain = { id: 'a', kind: 'sma' };
    const out = sanitizeIndicatorSpecs<unknown>([plain, { id: 'b', hideOn: ['days', 'x'] }, { id: 'c', hideOn: 'days' }, { id: 'd', hideOn: [] }, 7, null]);
    expect(out[0]).toBe(plain);
    expect(out.slice(1)).toEqual([{ id: 'b', hideOn: ['days'] }, { id: 'c' }, { id: 'd' }, 7, null]);
  });
});

describe('sanitizeIndicatorDefaults', () => {
  it('keeps known built-in kinds with params clamped and finite', () => {
    const out = sanitizeIndicatorDefaults({
      ema: { params: { length: 99999, other: 3 }, hideOn: ['weeks', 'zzz'] },
      bb: { params: { length: NaN, mult: -4 } },
      pine: { params: {} },
      ghost: { params: {} },
      sma: 'x',
      rsi: null,
    });
    expect(out).toEqual({ ema: { params: { length: 2000 }, hideOn: ['weeks'] }, bb: { params: { length: 20, mult: 0.1 }, hideOn: [] } });
  });
  it('reads nothing from non-objects', () => {
    for (const bad of [undefined, null, 'x', 4, []]) expect(sanitizeIndicatorDefaults(bad)).toEqual({});
  });
  it('cleanIndicatorDefault refuses Pine', () => {
    expect(cleanIndicatorDefault('pine', { params: {}, hideOn: [] })).toBeNull();
    expect(cleanIndicatorDefault('sma', { params: { length: 20 }, hideOn: ['days'] })).toEqual({ params: { length: 20 }, hideOn: ['days'] });
  });
});

describe('indicatorDrawn', () => {
  const spec = { visible: true, hideOn: ['minutes' as const] };
  it('hides on the chosen kind only', () => {
    expect(indicatorDrawn(spec, '5m')).toBe(false);
    for (const tf of ['30s', '1h', '1d', '1w', '1M']) expect(indicatorDrawn(spec, tf)).toBe(true);
  });
  it('is never drawn when not visible', () => {
    expect(indicatorDrawn({ visible: false }, '1h')).toBe(false);
  });
  it('draws on an unknown or empty timeframe, or with no hideOn', () => {
    for (const tf of ['', 'xyz', null, undefined]) expect(indicatorDrawn(spec, tf)).toBe(true);
    expect(indicatorDrawn({ visible: true, hideOn: [] }, '5m')).toBe(true);
    expect(indicatorDrawn({ visible: true }, '5m')).toBe(true);
  });
});

describe('resetIndicator', () => {
  it('goes back to the built-in values without a saved default', () => {
    const s = { ...defaultIndicator('ema'), hideOn: ['days' as const] };
    s.params = { length: 3 };
    const r = resetIndicator(s, null);
    expect(r.params).toEqual({ length: 200 });
    expect('hideOn' in r).toBe(false);
    expect(r.id).toBe(s.id);
  });
  it('goes back to the saved default', () => {
    const s = defaultIndicator('ema');
    const r = resetIndicator(s, { params: { length: 55 }, hideOn: ['hours'] });
    expect([r.params, r.hideOn]).toEqual([{ length: 55 }, ['hours']]);
  });
  it('clears a Pine script inputs, calculation and hiding, and keeps its source', () => {
    const s = { ...defaultIndicator('pine'), inputs: { Fast: 3 }, calculation: { timeframe: 'W', gaps: false }, hideOn: ['days' as const] };
    const r = resetIndicator(s, { params: {}, hideOn: ['hours'] });
    expect(r.inputs).toEqual({});
    expect('calculation' in r).toBe(false);
    expect('hideOn' in r).toBe(false);
    expect(r.source).toBe(s.source);
  });
});

describe('defaultIndicator with a saved default', () => {
  it('starts from its params and hideOn', () => {
    const s = defaultIndicator('bb', { params: { length: 30, mult: 3 }, hideOn: ['months'] });
    expect([s.params, s.hideOn]).toEqual([{ length: 30, mult: 3 }, ['months']]);
  });
});

describe('indicatorShortName', () => {
  it('is short for moving averages and the Pine name for scripts', () => {
    expect([indicatorShortName('ema', 'x'), indicatorShortName('rsi', 'x'), indicatorShortName('pine', 'My script')]).toEqual(['EMA', 'RSI', 'My script']);
  });
});

describe('indicator style', () => {
  const garbage = { plots: { ema_EMA: { color: 'red', opacity: 150, width: 9, plotType: 'bars' }, bad: 'x' }, precision: 12, labelsOnScale: 3 };

  it('sanitizeIndicatorSpecs cleans a garbage style and removes an empty one', () => {
    const out = sanitizeIndicatorSpecs<Record<string, unknown>>([
      { id: 'a', style: garbage },
      { id: 'b', style: { plots: {} } },
      { id: 'c', style: 'x' },
      { id: 'd', style: { plots: { k: { color: '#AABBCC', lineStyle: 'dotted' } }, valuesInStatusLine: false } },
    ]);
    expect(out).toEqual([
      { id: 'a', style: { plots: { ema_EMA: { opacity: 100, width: 4 } }, precision: 8 } },
      { id: 'b' },
      { id: 'c' },
      { id: 'd', style: { plots: { k: { color: '#aabbcc', lineStyle: 'dotted' } }, valuesInStatusLine: false } },
    ]);
  });

  it('resetIndicator restores the saved default style, or removes it', () => {
    const styled = { ...defaultIndicator('ema'), style: { precision: 2 } };
    const saved = { params: { length: 9 }, hideOn: [], style: { labelsOnScale: false } };
    expect(resetIndicator(styled, saved).style).toEqual({ labelsOnScale: false });
    expect(resetIndicator(styled, saved).style).not.toBe(saved.style);
    expect('style' in resetIndicator(styled, null)).toBe(false);
    expect('style' in resetIndicator(styled, { params: {}, hideOn: [] })).toBe(false);
    const pine = { ...defaultIndicator('pine'), style: { precision: 2 } };
    expect('style' in resetIndicator(pine, undefined)).toBe(false);
  });

  it('Save as default round-trips the style, and defaultIndicator copies it', () => {
    const style = { plots: { ema_EMA: { visible: false } }, precision: 3 };
    const clean = sanitizeIndicatorDefaults({ ema: { params: { length: 12 }, hideOn: [], style } });
    expect(clean.ema.style).toEqual(style);
    expect(cleanIndicatorDefault('ema', { params: {}, hideOn: [], style: { precision: 99 } })?.style).toEqual({ precision: 8 });
    expect('style' in (cleanIndicatorDefault('ema', { params: {}, hideOn: [], style: {} }) ?? {})).toBe(false);
    const fresh = defaultIndicator('ema', clean.ema);
    expect(fresh.style).toEqual(style);
    expect(fresh.style).not.toBe(clean.ema.style);
    expect('style' in defaultIndicator('ema', { params: {}, hideOn: [] })).toBe(false);
  });
});
