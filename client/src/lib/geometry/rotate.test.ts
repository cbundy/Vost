import { describe, expect, it } from 'vitest';
import { GLYPH_SIZE_MAX, GLYPH_SIZE_MIN, angleFromDrag, boxCorners, clampSize, normalizeAngle, pointInBox, rotatePoint, rotationHandle, sizeFromCorner } from './rotate';

const C = { x: 100, y: 100 };
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6);
  expect(a.y).toBeCloseTo(b.y, 6);
};

describe('normalizeAngle', () => {
  it('folds negative and over-360 angles into 0..360', () => {
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(-720)).toBe(0);
    expect(normalizeAngle(Number.NaN)).toBe(0);
  });
});

describe('rotatePoint', () => {
  it('turns clockwise on the screen', () => {
    near(rotatePoint({ x: 100, y: 80 }, C, 90), { x: 120, y: 100 });
  });
});

describe('boxCorners', () => {
  it('gives the upright corners at 0 degrees', () => {
    expect(boxCorners(C, 40, 0).map((p) => [p.x, p.y])).toEqual([[80, 80], [120, 80], [120, 120], [80, 120]]);
  });
  it('puts the corners on the axes at 45 degrees', () => {
    const [tl, tr] = boxCorners(C, 40, 45);
    near(tl, { x: 100, y: 100 - 20 * Math.SQRT2 });
    near(tr, { x: 100 + 20 * Math.SQRT2, y: 100 });
  });
  it('turns the corners one place at 90 degrees', () => {
    const [tl] = boxCorners(C, 40, 90);
    near(tl, { x: 120, y: 80 });
  });
});

describe('pointInBox', () => {
  it('is inside the upright box and outside beyond it', () => {
    expect(pointInBox({ x: 119, y: 81 }, C, 40, 0)).toBe(true);
    expect(pointInBox({ x: 121, y: 100 }, C, 40, 0)).toBe(false);
  });
  it('follows the rotation at 45 degrees: a corner of the upright box falls outside', () => {
    expect(pointInBox({ x: 119, y: 81 }, C, 40, 45)).toBe(false);
    expect(pointInBox({ x: 100, y: 100 - 27 }, C, 40, 45)).toBe(true);
    expect(pointInBox({ x: 100, y: 100 - 29 }, C, 40, 45)).toBe(false);
  });
  it('is the same box turned a quarter at 90 degrees', () => {
    expect(pointInBox({ x: 119, y: 81 }, C, 40, 90)).toBe(true);
    expect(pointInBox({ x: 100, y: 79 }, C, 40, 90)).toBe(false);
  });
  it('grows by the tolerance', () => {
    expect(pointInBox({ x: 124, y: 100 }, C, 40, 0, 5)).toBe(true);
    expect(pointInBox({ x: 126, y: 100 }, C, 40, 0, 5)).toBe(false);
  });
});

describe('rotationHandle', () => {
  it('sits above the top edge at 0 degrees', () => {
    near(rotationHandle(C, 40, 0, 24), { x: 100, y: 56 });
  });
  it('turns with the box', () => {
    near(rotationHandle(C, 40, 90, 24), { x: 144, y: 100 });
    near(rotationHandle(C, 40, 45, 24), { x: 100 + 44 * Math.SQRT1_2, y: 100 - 44 * Math.SQRT1_2 });
  });
});

describe('sizeFromCorner', () => {
  it('gives the side whose corner is at the dragged distance', () => {
    expect(sizeFromCorner(C, { x: 120, y: 120 })).toBe(40);
    expect(sizeFromCorner(C, { x: 100 + 50, y: 100 + 50 })).toBe(100);
  });
  it('is held between the bounds', () => {
    expect(sizeFromCorner(C, C)).toBe(GLYPH_SIZE_MIN);
    expect(sizeFromCorner(C, { x: 5000, y: 5000 })).toBe(GLYPH_SIZE_MAX);
    expect(clampSize(Number.NaN)).toBe(GLYPH_SIZE_MIN);
  });
});

describe('angleFromDrag', () => {
  it('is 0 straight above, 90 to the right, 180 below, 270 to the left', () => {
    expect(angleFromDrag(C, { x: 100, y: 50 })).toBe(0);
    expect(angleFromDrag(C, { x: 150, y: 100 })).toBe(90);
    expect(angleFromDrag(C, { x: 100, y: 150 })).toBe(180);
    expect(angleFromDrag(C, { x: 50, y: 100 })).toBe(270);
  });
  it('snaps to 15 degree steps with Shift', () => {
    const p = (deg: number) => ({ x: 100 + 50 * Math.sin((deg * Math.PI) / 180), y: 100 - 50 * Math.cos((deg * Math.PI) / 180) });
    expect(angleFromDrag(C, p(38), true)).toBe(45);
    expect(angleFromDrag(C, p(37), false)).toBe(37);
    expect(angleFromDrag(C, p(353), true)).toBe(0);
    expect(angleFromDrag(C, p(-20), true)).toBe(345);
  });
  it('is 0 on the centre', () => {
    expect(angleFromDrag(C, C, true)).toBe(0);
  });
});
