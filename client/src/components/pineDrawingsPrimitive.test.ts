import { describe, expect, it } from 'vitest';
import { PineDrawingsPrimitive } from './pineDrawingsPrimitive';

const data = {
  lines: [{ pane: 'separate' as const, time1: 1, price1: 5, time2: 2, price2: 9, extend: 'none' as const, color: '#FF0000', style: 'solid' as const, arrows: 'none' as const, width: 1 }],
  boxes: [], polylines: [], linefills: [],
};

describe('PineDrawingsPrimitive', () => {
  it('never answers a hit test, so the objects cannot be selected or hovered', () => {
    const prim = new PineDrawingsPrimitive(() => [1, 2], false);
    prim.setData(data);
    expect(prim.hitTest()).toBeNull();
  });

  it('sets the price range only as the scale source of its pane', () => {
    const own = new PineDrawingsPrimitive(() => [1, 2], true);
    own.setData(data);
    expect(own.autoscaleInfo()).toEqual({ priceRange: { minValue: 5, maxValue: 9 } });
    const shared = new PineDrawingsPrimitive(() => [1, 2], false);
    shared.setData(data);
    expect(shared.autoscaleInfo()).toBeNull();
  });
});
