import { describe, expect, it } from 'vitest';
import { placeTip } from './tipPlacement';

const vp = { width: 1000, height: 600 };
const tip = { width: 320, height: 150 };

describe('placeTip', () => {
  it('goes below when it fits', () => {
    const p = placeTip({ left: 100, top: 100, width: 80, height: 40 }, tip, vp);
    expect(p).toMatchObject({ below: true, left: 100, top: 146 });
  });
  it('goes above with no room below', () => {
    const p = placeTip({ left: 100, top: 500, width: 80, height: 40 }, tip, vp);
    expect(p.below).toBe(false);
    expect(p.top).toBe(500 - 6 - 150);
  });
  it('clamps at the right edge', () => {
    const p = placeTip({ left: 950, top: 100, width: 40, height: 40 }, tip, vp);
    expect(p.left + p.width).toBe(1000 - 8);
  });
  it('clamps at the left edge', () => {
    expect(placeTip({ left: -20, top: 100, width: 40, height: 40 }, tip, vp).left).toBe(8);
  });
  it('caps a wide tip to the viewport', () => {
    const p = placeTip({ left: 50, top: 100, width: 40, height: 40 }, { width: 320, height: 100 }, { width: 200, height: 600 });
    expect(p.width).toBe(184);
    expect(p.left).toBe(8);
  });
});
