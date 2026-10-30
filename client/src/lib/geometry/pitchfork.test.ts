import { describe, expect, it } from 'vitest';
import { DEFAULT_PITCHFORK_LEVELS, clipLine, medianOrigin, pitchforkLines, type PitchforkLevel } from './pitchfork';

const p1 = { x: 100, y: 200 };
const p2 = { x: 200, y: 100 };
const p3 = { x: 300, y: 180 };
const W = 1000;
const H = 600;
const L = (value: number, on = true): PitchforkLevel => ({ value, color: '#fff', on });

describe('medianOrigin', () => {
  it('follows each variant on hand-worked points', () => {
    expect(medianOrigin('original', p1, p2, p3)).toEqual({ x: 100, y: 200 });
    expect(medianOrigin('schiff', p1, p2, p3)).toEqual({ x: 100, y: 150 });
    expect(medianOrigin('modifiedSchiff', p1, p2, p3)).toEqual({ x: 150, y: 150 });
    expect(medianOrigin('inside', p1, p2, p3)).toEqual({ x: 150, y: 150 });
  });
});

describe('pitchforkLines', () => {
  const s = pitchforkLines('original', [p1, p2, p3], [L(0.5), L(1)], W, H, false);
  it('draws the median from the origin through the midpoint of P2-P3 to the pane edge', () => {
    // M = (250,140), d = (150,-60): reaches y=0 at t=140/60.
    expect(s.median![0]).toEqual(p1);
    expect(s.median![1].y).toBeCloseTo(0);
    expect(s.median![1].x).toBeCloseTo(100 + 150 * (200 / 60));
  });
  it('draws a line each side of every enabled level, level 1 through P2 and P3', () => {
    expect(s.lines).toHaveLength(4);
    const one = s.lines.filter((l) => l.value === 1);
    const starts = one.map((l) => l.seg[0]);
    expect(starts).toContainEqual({ x: 300, y: 180 });
    expect(starts).toContainEqual({ x: 200, y: 100 });
    const half = s.lines.filter((l) => l.value === 0.5).map((l) => l.seg[0]);
    expect(half).toContainEqual({ x: 275, y: 160 });
    expect(half).toContainEqual({ x: 225, y: 120 });
  });
  it('extends backward only with extend', () => {
    const e = pitchforkLines('original', [p1, p2, p3], [L(1)], W, H, true);
    const f = s.lines.find((l) => l.value === 1 && l.side === 1)!;
    const g = e.lines.find((l) => l.value === 1 && l.side === 1)!;
    expect(g.seg[0].x).toBeLessThan(f.seg[0].x);
    for (const l of e.lines) for (const p of l.seg) expect(p.x >= -1e-9 && p.x <= W + 1e-9 && p.y >= -1e-9 && p.y <= H + 1e-9).toBe(true);
  });
  it('keeps the median starting at the origin under extend', () => {
    const e = pitchforkLines('original', [p1, p2, p3], [L(1)], W, H, true);
    expect(e.median![0]).toEqual(p1);
  });
  it('fills between adjacent enabled lines on each side', () => {
    expect(s.fills).toHaveLength(4);
    const fresh = pitchforkLines('original', [p1, p2, p3], [L(0.5), L(1, false)], W, H, false);
    expect(fresh.fills).toHaveLength(2);
  });
  it('skips disabled levels', () => {
    expect(pitchforkLines('original', [p1, p2, p3], DEFAULT_PITCHFORK_LEVELS, W, H, false).lines).toHaveLength(4);
  });
  it('returns finite or empty output for degenerate input', () => {
    const cases: [typeof p1, typeof p1, typeof p1][] = [
      [p1, p2, p2],
      [{ x: 250, y: 140 }, p2, p3],
      [{ x: 200, y: 400 }, { x: 200, y: 100 }, { x: 200, y: 100 }],
      [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 100 }],
    ];
    for (const c of cases) {
      const r = pitchforkLines('original', c, [L(1)], W, H, true);
      for (const l of r.lines) for (const p of l.seg) expect(Number.isFinite(p.x + p.y)).toBe(true);
    }
    expect(pitchforkLines('original', [{ x: 250, y: 140 }, p2, p3], [L(1)], W, H, false).median).toBeNull();
    const vertical = pitchforkLines('original', [{ x: 250, y: 400 }, p2, { x: 300, y: 100 }], [L(1)], W, H, false);
    expect(vertical.median).not.toBeNull();
  });
});

describe('clipLine', () => {
  it('is null when the ray leaves the pane without crossing it', () => {
    expect(clipLine({ x: -10, y: 10 }, { x: -1, y: 0 }, W, H, false)).toBeNull();
    expect(clipLine({ x: 5, y: 5 }, { x: 0, y: 0 }, W, H, false)).toBeNull();
  });
});
