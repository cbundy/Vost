import { describe, expect, it } from 'vitest';
import { DrawingPrimitive } from './drawingPrimitive';

const TIMES = [100, 200, 300];
const HEIGHT = 200;

/** A chart whose price scale shows 0..100 over 0..200 pixels, newest-last times at 10 px per bar. */
function attach(prim: DrawingPrimitive, timeFormatter?: (t: number) => string) {
  const chart = {
    timeScale: () => ({ logicalToCoordinate: (l: number) => l * 10 }),
    paneSize: () => ({ width: 400, height: HEIGHT }),
    options: () => ({ localization: { timeFormatter } }),
  };
  const series = {
    priceToCoordinate: (p: number) => (p < 0 || p > 100 ? null : HEIGHT - p * 2),
    coordinateToPrice: (y: number) => 100 - y / 2,
    priceFormatter: () => ({ format: (p: number) => `$${p}` }),
  };
  prim.attached({ chart, series, requestUpdate: () => {} } as never);
}
const make = (fmt?: (t: number) => string) => {
  const prim = new DrawingPrimitive(() => TIMES);
  attach(prim, fmt);
  return prim;
};

describe('toPoint', () => {
  it('drops an anchor whose price is off the scale unless the tool spans the height', () => {
    const prim = make();
    const off = { time: 200, price: 500 };
    expect(prim.toPoint(off)).toBeNull();
    expect(prim.toPoint(off, false, true)).toEqual({ x: 10, y: 0 });
    expect(prim.toPoint({ time: 200, price: -500 }, false, true)).toEqual({ x: 10, y: HEIGHT });
  });
  it('places a vertical line whose price is scrolled off the scale, and hits it', () => {
    const prim = make();
    prim.set([{ id: 'v', tool: 'verticalLine', anchors: [{ time: 200, price: 900 }] }], null, null);
    expect(prim.hit({ x: 10, y: 120 })).toEqual({ id: 'v', handle: null });
    expect(prim.hit({ x: 60, y: 120 })).toBeNull();
  });
  it('places a cross line with either coordinate off its scale', () => {
    const prim = make();
    prim.set([{ id: 'c', tool: 'crossLine', anchors: [{ time: 200, price: 900 }] }], null, null);
    expect(prim.hit({ x: 10, y: 50 })).toEqual({ id: 'c', handle: null });
    expect(prim.hit({ x: 300, y: 1 })).toEqual({ id: 'c', handle: null });
  });
});

describe('axis views', () => {
  const cross = { id: 'c', tool: 'crossLine', anchors: [{ time: 200, price: 40 }] };
  const hline = { id: 'h', tool: 'horizontalLine', anchors: [{ time: 100, price: 70 }] };
  const texts = (views: readonly { text(): string }[]) => views.map((v) => v.text());

  it('shows a price and a time label for the selected cross line only', () => {
    const prim = make((t) => `t${t}`);
    prim.set([cross], null, null);
    expect(prim.priceAxisViews()).toHaveLength(0);
    expect(prim.timeAxisViews()).toHaveLength(0);
    prim.set([cross], 'c', null);
    expect(texts(prim.priceAxisViews())).toEqual(['$40']);
    expect(texts(prim.timeAxisViews())).toEqual(['t200']);
    expect(prim.priceAxisViews()[0].coordinate()).toBe(120);
    expect(prim.timeAxisViews()[0].coordinate()).toBe(10);
    expect(prim.priceAxisViews()[0].visible?.()).toBe(true);
  });
  it('labels the horizontal line price as before, selected or not, and not with showLabel false', () => {
    const prim = make();
    prim.set([hline], null, null);
    expect(texts(prim.priceAxisViews())).toEqual(['$70']);
    prim.set([hline], 'h', null);
    expect(texts(prim.priceAxisViews())).toEqual(['$70']);
    expect(prim.timeAxisViews()).toHaveLength(0);
    prim.set([{ ...hline, style: { showLabel: false } }], 'h', null);
    expect(prim.priceAxisViews()).toHaveLength(0);
  });
  it('hides a price label that is off the scale', () => {
    const prim = make();
    prim.set([{ ...hline, anchors: [{ time: 100, price: 900 }] }], null, null);
    expect(prim.priceAxisViews()[0].visible?.()).toBe(false);
  });
});
