import { describe, expect, it } from 'vitest';
import type { Alert, AlertCondition } from '../../shared/alerts.ts';
import { MAX_ALERTS, editAlert, evaluate, newAlert, parseAlertEdit, parseAlertInput } from './model.ts';

const make = (condition: AlertCondition, level = 100): Alert => newAlert({ provider: 'binance', symbol: 'BTCUSDT', condition, level, note: '' }, 'a1', 1);

/** Feeds prices one after another; returns the alert and the index of the price that fired it. */
function run(alert: Alert, prices: number[]): { alert: Alert; firedAt: number[] } {
  const firedAt: number[] = [];
  prices.forEach((p, i) => {
    const next = evaluate(alert, p, 1000 + i);
    if (alert.status === 'active' && next.status === 'triggered') firedAt.push(i);
    alert = next;
  });
  return { alert, firedAt };
}

describe('evaluate', () => {
  it('the first price only records the side', () => {
    const a = evaluate(make('crossing-up'), 150, 5);
    expect(a.status).toBe('active');
    expect(a.lastPrice).toBe(150);
  });

  it('crossing-up fires from below to the level and from below to above', () => {
    expect(run(make('crossing-up'), [90, 100]).firedAt).toEqual([1]);
    expect(run(make('crossing-up'), [90, 120]).firedAt).toEqual([1]);
  });

  it('crossing-up ignores a fall and a start above', () => {
    expect(run(make('crossing-up'), [120, 90, 80]).firedAt).toEqual([]);
    expect(run(make('crossing-up'), [120, 130]).firedAt).toEqual([]);
  });

  it('crossing-down fires from above to the level and to below', () => {
    expect(run(make('crossing-down'), [120, 100]).firedAt).toEqual([1]);
    expect(run(make('crossing-down'), [120, 90]).firedAt).toEqual([1]);
    expect(run(make('crossing-down'), [90, 120]).firedAt).toEqual([]);
  });

  it('a start exactly on the level fires nothing until the price has left it and come back', () => {
    expect(run(make('crossing-up'), [100, 110]).firedAt).toEqual([]);
    expect(run(make('crossing'), [100, 100, 100]).firedAt).toEqual([]);
    expect(run(make('crossing'), [100, 90]).firedAt).toEqual([]);
    expect(run(make('crossing'), [100, 90, 100]).firedAt).toEqual([2]);
  });

  it('crossing fires in either direction', () => {
    expect(run(make('crossing'), [90, 110]).firedAt).toEqual([1]);
    expect(run(make('crossing'), [110, 90]).firedAt).toEqual([1]);
  });

  it('records the trigger and then ignores further prices', () => {
    const { alert, firedAt } = run(make('crossing-up'), [90, 110, 90, 120, 80]);
    expect(firedAt).toEqual([1]);
    expect(alert).toMatchObject({ status: 'triggered', triggeredAt: 1001, triggerPrice: 110, lastPrice: 110 });
  });

  it('returns the same object when nothing changes, and ignores a non-finite price', () => {
    const a = evaluate(make('crossing-up'), 90, 1);
    expect(evaluate(a, 90, 2)).toBe(a);
    expect(evaluate(a, NaN, 2)).toBe(a);
  });

  it('editing a triggered alert re-arms it', () => {
    const { alert } = run(make('crossing-up'), [90, 110]);
    const again = editAlert(alert, { level: 200 });
    expect(again).toMatchObject({ status: 'active', level: 200, lastPrice: null, triggeredAt: null, triggerPrice: null });
    expect(run(again, [150, 210]).firedAt).toEqual([1]);
  });
});

describe('editAlert and delivery', () => {
  it('clears the Telegram delivery fields', () => {
    const { alert } = run(make('crossing-up'), [90, 110]);
    const sent: Alert = { ...alert, telegram: 'failed', telegramError: 'nope' };
    const again = editAlert(sent, { level: 200 });
    expect(again).not.toHaveProperty('telegram');
    expect(again).not.toHaveProperty('telegramError');
  });
});

describe('parseAlertInput', () => {
  const ok = { provider: 'binance', symbol: ' btcusdt ', condition: 'crossing-up', level: 5, note: 'x' };
  it('trims and upper-cases the symbol and ignores unknown fields', () => {
    expect(parseAlertInput({ ...ok, extra: 1 }, 0)).toEqual({ provider: 'binance', symbol: 'BTCUSDT', condition: 'crossing-up', level: 5, note: 'x' });
  });
  it('note is optional', () => {
    expect(parseAlertInput({ ...ok, note: undefined }, 0).note).toBe('');
  });
  it.each([
    ['unknown provider', { ...ok, provider: 'nope' }],
    ['demo', { ...ok, provider: 'demo' }],
    ['csv', { ...ok, provider: 'csv' }],
    ['empty symbol', { ...ok, symbol: '   ' }],
    ['long symbol', { ...ok, symbol: 'A'.repeat(41) }],
    ['bad condition', { ...ok, condition: 'up' }],
    ['level 0', { ...ok, level: 0 }],
    ['negative level', { ...ok, level: -1 }],
    ['NaN level', { ...ok, level: NaN }],
    ['string level', { ...ok, level: '5' }],
    ['long note', { ...ok, note: 'n'.repeat(201) }],
    ['not an object', 'x'],
    ['array', []],
  ])('rejects %s', (_name, body) => {
    expect(() => parseAlertInput(body, 0)).toThrow();
  });
  it('accepts a 200 char note and refuses the 501st alert', () => {
    expect(parseAlertInput({ ...ok, note: 'n'.repeat(200) }, 0).note).toHaveLength(200);
    expect(() => parseAlertInput(ok, MAX_ALERTS)).toThrow(/500/);
    expect(() => parseAlertInput(ok, MAX_ALERTS - 1)).not.toThrow();
  });
});

describe('parseAlertEdit', () => {
  it('keeps only valid fields and rejects bad ones', () => {
    expect(parseAlertEdit({ level: 3, provider: 'x' })).toEqual({ level: 3 });
    expect(() => parseAlertEdit({ level: 0 })).toThrow();
    expect(() => parseAlertEdit({ condition: 'x' })).toThrow();
    expect(() => parseAlertEdit({ note: 5 })).toThrow();
  });
});
