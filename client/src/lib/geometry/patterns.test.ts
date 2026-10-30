import { describe, expect, it } from 'vitest';
import { ABCD, CYPHER, XABCD, formatRatio, labelOffset, legRatio, lineRatio } from './patterns';

describe('legRatio and formatRatio', () => {
  it('divides absolute moves and gives null for a flat divisor', () => {
    expect(legRatio(-6, 3)).toBe(2);
    expect(legRatio(5, 0)).toBeNull();
    expect(legRatio(Number.NaN, 1)).toBeNull();
    expect(legRatio(Infinity, 1)).toBeNull();
  });
  it('shows 3 decimals', () => {
    expect(formatRatio(0.6180339)).toBe('0.618');
    expect(formatRatio(2)).toBe('2.000');
  });
});

describe('the ratio lines', () => {
  // A bullish Gartley: X 100, A 200, B 138.2 (AB/XA 0.618), C 176.4, D 121.4 (AD/XA 0.786 from A: 200-121.4=78.6).
  const gartley = [100, 200, 138.2, 176.4, 121.4];
  it('XABCD matches the TradingView set', () => {
    expect(XABCD.ratios.map((r) => [r.from, r.to, r.name])).toEqual([[0, 2, 'AB/XA'], [1, 3, 'BC/AB'], [2, 4, 'CD/BC'], [0, 4, 'AD/XA']]);
    const v = XABCD.ratios.map((r) => formatRatio(lineRatio(r, gartley)!));
    expect(v[0]).toBe('0.618');
    expect(v[3]).toBe('0.786');
  });
  it('Cypher and ABCD match', () => {
    expect(CYPHER.ratios.map((r) => [r.from, r.to, r.name])).toEqual([[0, 2, 'AB/XA'], [0, 3, 'XC/XA'], [0, 4, 'CD/XC']]);
    expect(ABCD.ratios.map((r) => [r.from, r.to, r.name])).toEqual([[0, 2, 'BC/AB'], [1, 3, 'CD/BC']]);
    expect(CYPHER.labels).toHaveLength(5);
    expect(ABCD.labels).toHaveLength(4);
  });
  it('a 1:1 ABCD gives CD/BC 1', () => {
    // A 100, B 200, C 150, D 250: BC 50, CD 100 -> 2; a symmetric one: A 100, B 200, C 150, D 200 -> CD/BC 1
    expect(lineRatio(ABCD.ratios[1], [100, 200, 150, 200])).toBe(1);
    expect(lineRatio(ABCD.ratios[0], [100, 200, 150, 200])).toBe(0.5);
  });
  it('is null for a flat divisor leg or a missing point', () => {
    expect(lineRatio(ABCD.ratios[0], [100, 100, 150, 200])).toBeNull();
    expect(lineRatio(ABCD.ratios[0], [100, 200])).toBeNull();
  });
  it('fills only the triangles of XABCD and Cypher', () => {
    expect(XABCD.fills).toEqual([[0, 1, 2], [2, 3, 4]]);
    expect(CYPHER.fills).toHaveLength(2);
    expect(ABCD.fills).toEqual([]);
  });
});

describe('labelOffset', () => {
  it('puts a peak above and a trough below, away from its neighbours', () => {
    const pts = [{ x: 0, y: 50 }, { x: 50, y: 0 }, { x: 100, y: 50 }, { x: 150, y: 0 }];
    expect(labelOffset(pts, 1).y).toBeLessThan(0);
    expect(labelOffset(pts, 2).y).toBeGreaterThan(50);
  });
  it('puts a lone point above', () => {
    expect(labelOffset([{ x: 5, y: 5 }], 0)).toEqual({ x: 5, y: -7 });
  });
});
