import { describe, expect, it } from 'vitest';
import { DrawingPrimitive } from './drawingPrimitive';
import { fractionToPoint, pointToFraction } from './paneAnchor';
import { getTool } from './tools';

describe('pane fractions', () => {
  it('converts a fraction to pixels and back', () => {
    const p = fractionToPoint({ time: 0.25, price: 0.5 }, 400, 200);
    expect(p).toEqual({ x: 100, y: 100 });
    expect(pointToFraction(p, 400, 200)).toEqual({ time: 0.25, price: 0.5 });
  });
  it('clamps at 0 and 1', () => {
    expect(fractionToPoint({ time: -1, price: 2 }, 400, 200)).toEqual({ x: 0, y: 200 });
    expect(pointToFraction({ x: -20, y: 900 }, 400, 200)).toEqual({ time: 0, price: 1 });
  });
  it('gives the same fraction on a smaller pane and different pixels', () => {
    expect(fractionToPoint({ time: 0.5, price: 0.5 }, 200, 100)).toEqual({ x: 100, y: 50 });
  });
  it('does not throw or give NaN for a pane of no size', () => {
    expect(pointToFraction({ x: 10, y: 10 }, 0, 0)).toEqual({ time: 0, price: 0 });
    expect(fractionToPoint({ time: 0.5, price: 0.5 }, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(fractionToPoint({ time: NaN, price: 0.5 }, 10, 10)).toEqual({ x: 0, y: 5 });
  });
});

describe('the primitive keeps a pane-anchored drawing on the pane', () => {
  const make = (range: { from: number }) => {
    const prim = new DrawingPrimitive(() => [100, 200, 300]);
    prim.attached({
      chart: {
        timeScale: () => ({ logicalToCoordinate: (l: number) => (l - range.from) * 10, coordinateToLogical: (x: number) => x / 10 + range.from }),
        paneSize: () => ({ width: 400, height: 200 }),
        options: () => ({ localization: {} }),
      },
      series: { priceToCoordinate: (p: number) => 200 - p, coordinateToPrice: (y: number) => 200 - y, priceFormatter: () => ({ format: String }) },
      requestUpdate: () => {},
    } as never);
    return prim;
  };
  it('gives the same pixels whatever the time range', () => {
    const tool = getTool('anchoredText');
    const a = { time: 0.5, price: 0.25 };
    expect(make({ from: 0 }).toPoint(a, tool)).toEqual({ x: 200, y: 50 });
    expect(make({ from: 500 }).toPoint(a, tool)).toEqual({ x: 200, y: 50 });
  });
  it('turns a pixel into a clamped fraction', () => {
    const tool = getTool('anchoredText');
    expect(make({ from: 0 }).toAnchor({ x: 100, y: 100 }, tool)).toEqual({ time: 0.25, price: 0.5 });
    expect(make({ from: 0 }).toAnchor({ x: 900, y: -5 }, tool)).toEqual({ time: 1, price: 0 });
  });
});
