import { describe, expect, it } from 'vitest';
import { ELLIOTT_DEFAULT_DEGREE, ELLIOTT_DEGREES, ELLIOTT_WAVES, waveFormat, waveLabel, type ElliottKind } from './elliott';

const labels = (kind: ElliottKind, degree: string) => ELLIOTT_WAVES[kind].map((_, i) => waveLabel(kind, i, degree));

describe('Elliott wave degrees', () => {
  it('has unique values and a default that is in the list', () => {
    const values = ELLIOTT_DEGREES.map((d) => d.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain(ELLIOTT_DEFAULT_DEGREE);
  });
  it('has TradingView\'s 15 degrees in its order, with Intermediate as the default', () => {
    expect(ELLIOTT_DEGREES.map((d) => d.label)).toEqual([
      'Supermillennium', 'Millennium', 'Submillennium', 'Grand Supercycle', 'Supercycle', 'Cycle', 'Primary', 'Intermediate',
      'Minor', 'Minute', 'Minuette', 'Subminuette', 'Micro', 'Submicro', 'Minuscule',
    ]);
    expect(ELLIOTT_DEFAULT_DEGREE).toBe('intermediate');
  });
  it('labels an impulse for each degree as TradingView does', () => {
    const arabic = ['1', '2', '3', '4', '5'];
    const lower = ['i', 'ii', 'iii', 'iv', 'v'];
    const upper = ['I', 'II', 'III', 'IV', 'V'];
    const br = (a: string[]) => a.map((x) => `(${x})`);
    const table: Record<string, string[]> = {
      supermillennium: arabic, millennium: br(arabic), submillennium: arabic,
      grandSupercycle: upper, supercycle: br(upper), cycle: upper,
      primary: arabic, intermediate: br(arabic), minor: arabic,
      minute: lower, minuette: br(lower), subminuette: lower,
      micro: arabic, submicro: br(arabic), minuscule: arabic,
    };
    for (const d of ELLIOTT_DEGREES) expect(labels('impulse', d.value), d.value).toEqual([d.decoration === 'brackets' ? '(0)' : '0', ...table[d.value]]);
  });
  it('decorates the largest degree of each triple with a circle, the middle with brackets and the smallest with none', () => {
    const dec = (v: string) => ELLIOTT_DEGREES.find((d) => d.value === v)!.decoration;
    for (const v of ['supermillennium', 'grandSupercycle', 'primary', 'minute', 'micro']) expect(dec(v), v).toBe('circle');
    for (const v of ['millennium', 'supercycle', 'intermediate', 'minuette', 'submicro']) expect(dec(v), v).toBe('brackets');
    for (const v of ['submillennium', 'cycle', 'minor', 'subminuette', 'minuscule']) expect(dec(v), v).toBe('none');
  });
  it('gives each group its TradingView font size and weight, and a circle only for a circled degree', () => {
    expect(waveFormat('grandSupercycle')).toEqual({ fontSize: 20, bold: false, circle: 28 });
    expect(waveFormat('supermillennium')).toEqual({ fontSize: 24, bold: true, circle: 36 });
    expect(waveFormat('intermediate')).toEqual({ fontSize: 18, bold: false, circle: 0 });
    expect(waveFormat('minute')).toEqual({ fontSize: 16, bold: false, circle: 22 });
    expect(waveFormat('micro')).toEqual({ fontSize: 11, bold: true, circle: 14 });
    expect(waveFormat('intermediate', 24).fontSize).toBe(36);
  });
  it('labels the corrective tools with letters in the degree notation', () => {
    expect(labels('correction', 'primary')).toEqual(['0', 'A', 'B', 'C']);
    expect(labels('correction', 'cycle')).toEqual(['0', 'a', 'b', 'c']);
    expect(labels('correction', 'minute')).toEqual(['0', 'a', 'b', 'c']);
    expect(labels('triangle', 'intermediate')).toEqual(['(0)', '(A)', '(B)', '(C)', '(D)', '(E)']);
    expect(labels('doubleCombo', 'subminuette')).toEqual(['0', 'w', 'x', 'y']);
    expect(labels('tripleCombo', 'supercycle')).toEqual(['(0)', '(w)', '(x)', '(y)', '(x)', '(z)']);
  });
  it('labels the origin 0 in every degree', () => {
    for (const d of ELLIOTT_DEGREES) expect(waveLabel('impulse', 0, d.value)).toBe(d.decoration === 'brackets' ? '(0)' : '0');
  });
  it('uses the default for an unknown degree and "" for a missing point', () => {
    expect(labels('impulse', 'nope')).toEqual(labels('impulse', ELLIOTT_DEFAULT_DEGREE));
    expect(waveLabel('impulse', 9, 'minor')).toBe('');
    expect(waveLabel('impulse', -1, 'minor')).toBe('');
  });
  it('has the point counts 6, 4, 6, 4 and 6', () => {
    expect(Object.values(ELLIOTT_WAVES).map((w) => w.length)).toEqual([6, 4, 6, 4, 6]);
  });
});
