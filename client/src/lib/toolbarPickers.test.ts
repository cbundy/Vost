import { describe, expect, it } from 'vitest';
import { getTool } from '../components/chart/tools';
import { pickerFields, widthChoices, withStyleValue } from './toolbarPickers';

const fieldsOf = (id: string) => pickerFields(getTool(id)?.settings);
const keys = (id: string) => Object.keys(fieldsOf(id)).sort();

describe('pickerFields', () => {
  it('gives a trend line colour, width and line style', () => {
    expect(keys('trendLine')).toEqual(['color', 'lineStyle', 'width']);
  });
  it('gives a tool only the fields it declares', () => {
    const declared = new Set((getTool('horizontalLine')?.settings ?? []).map((f) => f.kind));
    expect(keys('horizontalLine')).toEqual((['color', 'lineStyle', 'width'] as const).filter((k) => declared.has(k)).sort());
    const text = new Set((getTool('text')?.settings ?? []).map((f) => f.kind));
    expect('lineStyle' in fieldsOf('text')).toBe(text.has('lineStyle'));
  });
  it('gives no picker to a tool without settings', () => {
    expect(pickerFields(undefined)).toEqual({});
    expect(pickerFields([])).toEqual({});
  });
  it('takes the first field of a kind', () => {
    const f = (key: string) => ({ key, label: key, kind: 'color' as const, tab: 'style' as const, default: 'accent' });
    expect(pickerFields([f('a'), f('b')]).color?.key).toBe('a');
  });
});

describe('widthChoices', () => {
  it('runs from the minimum to the maximum in whole steps', () => {
    expect(widthChoices({ min: 0.5, max: 10 })).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(widthChoices({ min: 1, max: 4 })).toEqual([1, 2, 3, 4]);
  });
});

describe('withStyleValue', () => {
  it('sets one key and keeps the others', () => {
    expect(withStyleValue({ width: 2, color: 'red' }, 'width', 3)).toEqual({ width: 3, color: 'red' });
    expect(withStyleValue(undefined, 'width', 3)).toEqual({ width: 3 });
  });
});
