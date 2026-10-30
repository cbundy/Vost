import { describe, expect, it } from 'vitest';
import { FLAG, POLE, anchorOutside, flagHit, flagShape, priceTagBody, priceTagOutline, signpostShape } from './markers';

const pane = { width: 400, height: 300 };

describe('priceTagOutline', () => {
  it('has its point at the tip and its body to the right', () => {
    const o = priceTagOutline({ x: 100, y: 100 }, { width: 50, height: 20 });
    expect(o[0]).toEqual({ x: 100, y: 100 });
    expect(priceTagBody(o)).toEqual({ x: 110, y: 90, w: 50, h: 20 });
  });
  it('is kept inside the pane near its edges', () => {
    for (const tip of [{ x: 395, y: 2 }, { x: -20, y: 310 }]) {
      const o = priceTagOutline(tip, { width: 50, height: 20 }, pane);
      for (const p of o) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(pane.width);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(pane.height);
      }
    }
  });
  it('gives no NaN for an anchor off the pane', () => {
    const o = priceTagOutline({ x: NaN, y: Infinity }, { width: 50, height: 20 }, pane);
    expect(o).toHaveLength(5);
  });
});

describe('signpostShape', () => {
  const size = { width: 30, height: 30 };
  it('puts the plate above or below the anchor by position', () => {
    const up = signpostShape({ x: 200, y: 150 }, size, 'above', pane);
    const down = signpostShape({ x: 200, y: 150 }, size, 'below', pane);
    expect(up.plate.y + up.plate.h).toBeLessThanOrEqual(150 - POLE + 0.001);
    expect(down.plate.y).toBeGreaterThanOrEqual(150 + POLE - 0.001);
    expect(up.pole[0]).toEqual({ x: 200, y: 150 });
    expect(up.pole[1].y).toBe(up.plate.y + up.plate.h);
    expect(down.pole[1].y).toBe(down.plate.y);
  });
  it('keeps the plate inside the pane except when free', () => {
    expect(signpostShape({ x: 5, y: 10 }, size, 'above', pane).plate).toMatchObject({ x: 0, y: 0 });
    expect(signpostShape({ x: 5, y: -400 }, size, 'above', pane, true).plate.y).toBeLessThan(0);
  });
  it('knows an anchor outside the pane', () => {
    expect(anchorOutside({ x: 10, y: 10 }, pane)).toBe(false);
    expect(anchorOutside({ x: 10, y: -1 }, pane)).toBe(true);
    expect(anchorOutside({ x: NaN, y: 1 }, pane)).toBe(true);
  });
});

describe('flagShape', () => {
  it('has its pole at the anchor and the flag on top of it', () => {
    const { pole, flag } = flagShape({ x: 50, y: 100 });
    expect(pole[0]).toEqual({ x: 50, y: 100 });
    expect(flag[0]).toEqual({ x: 50, y: 100 - POLE });
    expect(Math.max(...flag.map((p) => p.x))).toBe(50 + FLAG.W);
  });
  it('is hit on the flag and the pole, not far away', () => {
    expect(flagHit({ x: 50, y: 100 }, { x: 58, y: 100 - POLE + 5 }, 0)).toBe(true);
    expect(flagHit({ x: 50, y: 100 }, { x: 50, y: 90 }, 0)).toBe(true);
    expect(flagHit({ x: 50, y: 100 }, { x: 80, y: 100 }, 0)).toBe(false);
  });
});
