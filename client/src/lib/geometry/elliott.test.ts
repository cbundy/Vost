import { describe, expect, it } from 'vitest';
import { ELLIOTT_DEFAULT_DEGREE, ELLIOTT_DEGREES, ELLIOTT_WAVES, waveLabel, type ElliottKind } from './elliott';

const labels = (kind: ElliottKind, degree: string) => ELLIOTT_WAVES[kind].map((_, i) => waveLabel(kind, i, degree));

describe('Elliott wave degrees', () => {
  it('has unique values and a default that is in the list', () => {
    const values = ELLIOTT_DEGREES.map((d) => d.value);
    expect(new Set(values).size).toBe(values.length);
    expect(values).toContain(ELLIOTT_DEFAULT_DEGREE);
  });
  it('labels an impulse for each degree', () => {
    const table: Record<string, string[]> = {
      grandSupercycle: ['((I))', '((II))', '((III))', '((IV))', '((V))'],
      supercycle: ['(I)', '(II)', '(III)', '(IV)', '(V)'],
      cycle: ['I', 'II', 'III', 'IV', 'V'],
      primary: ['((1))', '((2))', '((3))', '((4))', '((5))'],
      intermediate: ['(1)', '(2)', '(3)', '(4)', '(5)'],
      minor: ['1', '2', '3', '4', '5'],
      minute: ['((i))', '((ii))', '((iii))', '((iv))', '((v))'],
      minuette: ['(i)', '(ii)', '(iii)', '(iv)', '(v)'],
      subMinuette: ['i', 'ii', 'iii', 'iv', 'v'],
    };
    for (const d of ELLIOTT_DEGREES) expect(labels('impulse', d.value)).toEqual(['', ...table[d.value]]);
  });
  it('labels the corrective tools with letters in the degree notation', () => {
    expect(labels('correction', 'primary')).toEqual(['', '((A))', '((B))', '((C))']);
    expect(labels('correction', 'minor')).toEqual(['', 'A', 'B', 'C']);
    expect(labels('correction', 'minute')).toEqual(['', '((a))', '((b))', '((c))']);
    expect(labels('triangle', 'intermediate')).toEqual(['', '(A)', '(B)', '(C)', '(D)', '(E)']);
    expect(labels('doubleCombo', 'subMinuette')).toEqual(['', 'w', 'x', 'y']);
    expect(labels('tripleCombo', 'supercycle')).toEqual(['', '(W)', '(X)', '(Y)', '(X)', '(Z)']);
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
