import { describe, expect, it } from 'vitest';
import { DrawingPrimitive } from './drawingPrimitive';
import { getTool } from './tools';

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
    options: () => ({ priceFormat: { type: 'price', precision: 2, minMove: 0.01 } }),
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
    expect(prim.toPoint(off, getTool('verticalLine'))).toEqual({ x: 10, y: 0 });
    expect(prim.toPoint({ time: 200, price: -500 }, getTool('verticalLine'))).toEqual({ x: 10, y: HEIGHT });
  });
  it('places a vertical line whose price is scrolled off the scale, and hits it', () => {
    const prim = make();
    prim.set([{ id: 'v', tool: 'verticalLine', anchors: [{ time: 200, price: 900 }] }], [], null);
    expect(prim.hit({ x: 10, y: 120 })).toEqual({ id: 'v', handle: null });
    expect(prim.hit({ x: 60, y: 120 })).toBeNull();
  });
  it('places a cross line with either coordinate off its scale', () => {
    const prim = make();
    prim.set([{ id: 'c', tool: 'crossLine', anchors: [{ time: 200, price: 900 }] }], [], null);
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
    prim.set([cross], [], null);
    expect(prim.priceAxisViews()).toHaveLength(0);
    expect(prim.timeAxisViews()).toHaveLength(0);
    prim.set([cross], ['c'], null);
    expect(texts(prim.priceAxisViews())).toEqual(['$40']);
    expect(texts(prim.timeAxisViews())).toEqual(['t200']);
    expect(prim.priceAxisViews()[0].coordinate()).toBe(120);
    expect(prim.timeAxisViews()[0].coordinate()).toBe(10);
    expect(prim.priceAxisViews()[0].visible?.()).toBe(true);
  });
  it('labels the horizontal line price as before, selected or not, and not with showLabel false', () => {
    const prim = make();
    prim.set([hline], [], null);
    expect(texts(prim.priceAxisViews())).toEqual(['$70']);
    prim.set([hline], ['h'], null);
    expect(texts(prim.priceAxisViews())).toEqual(['$70']);
    expect(prim.timeAxisViews()).toHaveLength(0);
    prim.set([{ ...hline, style: { showLabel: false } }], ['h'], null);
    expect(prim.priceAxisViews()).toHaveLength(0);
  });
  it('labels the times of a selected time zone from the loaded bars', () => {
    const prim = make((t) => `t${t}`);
    const zone = { id: 'z', tool: 'fibTimeZone', anchors: [{ time: 100, price: 10 }, { time: 200, price: 20 }], style: { levels: [{ value: 0, on: true, color: 'accent' }, { value: 1, on: true, color: 'accent' }, { value: 3, on: true, color: 'accent' }, { value: 5, on: false, color: 'accent' }] } };
    prim.set([zone], [], null);
    expect(prim.timeAxisViews()).toHaveLength(0);
    prim.set([zone], ['z'], null);
    // one unit is one bar (100 s); level 3 is past the last bar and is extrapolated
    expect(texts(prim.timeAxisViews())).toEqual(['t100', 't200', 't400']);
    expect(prim.timeAxisViews()[2].coordinate()).toBe(30);
  });
  it('hides a price label that is off the scale', () => {
    const prim = make();
    prim.set([{ ...hline, anchors: [{ time: 100, price: 900 }] }], [], null);
    expect(prim.priceAxisViews()[0].visible?.()).toBe(false);
  });
});

describe('the tool view', () => {
  const CANDLES = TIMES.map((time, i) => ({ time, open: i, high: i + 2, low: i - 1, close: i + 1 }));
  it('hands the loaded candles to a tool, live', () => {
    let candles = CANDLES;
    const prim = new DrawingPrimitive(() => TIMES, () => '', () => ({}), () => candles);
    attach(prim);
    const d = { tool: 'regressionTrend', anchors: [] };
    expect(prim.viewFor(d).candles).toBe(CANDLES);
    candles = [...CANDLES, { time: 400, open: 1, high: 2, low: 0, close: 1 }];
    expect(prim.viewFor(d).candles).toHaveLength(4);
  });
  it('has no candles when none are given', () => {
    expect(make().viewFor({ tool: 'regressionTrend', anchors: [] }).candles).toEqual([]);
  });
});

describe('a draft with several anchors', () => {
  const draft = (anchors: { time: number; price: number }[]) => ({ id: 'draft', tool: 'parallelChannel', anchors });
  function paint(prim: DrawingPrimitive) {
    const arcs: number[][] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : (...a: number[]) => void (k === 'arc' && arcs.push([a[0], a[1]]))),
      set: (t, k: string, v) => ((t[k] = v), true),
    });
    const target = { useMediaCoordinateSpace: (f: (s: unknown) => void) => f({ context: ctx, mediaSize: { width: 400, height: HEIGHT } }) };
    (prim.paneViews()[0].renderer() as { draw(t: unknown): void }).draw(target);
    return arcs;
  }
  it('shows the anchors placed so far as handles and not the moving one', () => {
    const prim = make();
    const a = { time: 100, price: 10 };
    const b = { time: 200, price: 50 };
    const c = { time: 300, price: 30 };
    prim.set([], [], draft([a, b]));
    expect(paint(prim)).toEqual([[0, 180]]);
    prim.set([], [], draft([a, b, b]));
    expect(paint(prim)).toEqual([[0, 180], [10, 100]]);
    prim.set([], [], draft([a, b, c]));
    expect(paint(prim)).toHaveLength(2);
  });
});

describe('locked drawings', () => {
  const trend = { id: 't', tool: 'trendLine', anchors: [{ time: 100, price: 20 }, { time: 300, price: 80 }] };
  it('hits a selected drawing handle only while it is unlocked', () => {
    const prim = make();
    prim.set([trend], ['t'], null);
    expect(prim.hit({ x: 0, y: 160 })).toEqual({ id: 't', handle: 0 });
    prim.set([{ ...trend, locked: true }], ['t'], null);
    expect(prim.hit({ x: 0, y: 160 })).toEqual({ id: 't', handle: null });
  });
});

describe('selection list', () => {
  const trend = { id: 't', tool: 'trendLine', anchors: [{ time: 100, price: 20 }, { time: 300, price: 80 }] };
  const hline = { id: 'h', tool: 'horizontalLine', anchors: [{ time: 100, price: 50 }] };
  const vline = { id: 'v', tool: 'verticalLine', anchors: [{ time: 200, price: 50 }] };
  it('idsInBox returns a drawing inside, leaves one partly outside, tests a horizontal line on y and a vertical line on x', () => {
    const prim = make();
    prim.set([trend, hline, vline], [], null);
    expect(prim.idsInBox({ left: -5, top: 0, right: 30, bottom: 200 })).toEqual(['t', 'h', 'v']);
    expect(prim.idsInBox({ left: -5, top: 0, right: 15, bottom: 200 })).toEqual(['h', 'v']);
    expect(prim.idsInBox({ left: 100, top: 90, right: 150, bottom: 110 })).toEqual(['h']);
    expect(prim.idsInBox({ left: 5, top: 500, right: 15, bottom: 600 })).toEqual(['v']);
  });
  it('a hidden drawing is not shown, not hit and not in a box', () => {
    const prim = make();
    expect(prim.shown(hline)).toBe(true);
    expect(prim.shown({ ...hline, hidden: true })).toBe(false);
    prim.set([trend, { ...hline, hidden: true }], [], null);
    expect(prim.hit({ x: 100, y: 100 })).toBeNull();
    expect(prim.idsInBox({ left: -5, top: 0, right: 30, bottom: 200 })).toEqual(['t']);
    prim.set([trend, hline], [], null);
    expect(prim.hit({ x: 100, y: 100 })).toEqual({ id: 'h', handle: null });
  });
  it('hit grabs a handle with one drawing selected and none with two', () => {
    const prim = make();
    const other = { ...trend, id: 'u' };
    prim.set([trend, other], ['t'], null);
    expect(prim.hit({ x: 0, y: 160 })).toEqual({ id: 't', handle: 0 });
    prim.set([trend, other], ['t', 'u'], null);
    expect(prim.hit({ x: 0, y: 160 })).toEqual({ id: 'u', handle: null });
  });
});

describe('note popups', () => {
  const pin = { id: 'n', tool: 'note', anchors: [{ time: 200, price: 50 }], text: 'POP' };
  const over = { id: 'o', tool: 'text', anchors: [{ time: 200, price: 50 }], text: 'OVER' };
  function texts(prim: DrawingPrimitive) {
    const out: string[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => void (k === 'fillText' && out.push(a[0] as string))),
      set: (t, k: string, v) => ((t[k] = v), true),
    });
    const target = { useMediaCoordinateSpace: (f: (s: unknown) => void) => f({ context: ctx, mediaSize: { width: 400, height: HEIGHT } }) };
    (prim.paneViews()[0].renderer() as { draw(t: unknown): void }).draw(target);
    return out;
  }
  it('paints no popup unless the note is hovered, selected or pinned', () => {
    const prim = make();
    prim.set([pin, over], [], null);
    expect(texts(prim)).toEqual(['OVER']);
  });
  it('paints a popup after every drawing, so none covers it', () => {
    const prim = make();
    prim.set([pin, over], [], null);
    prim.setPopups('n', new Set());
    expect(texts(prim)).toEqual(['OVER', 'POP']);
    prim.setPopups(null, new Set(['n']));
    expect(texts(prim)).toEqual(['OVER', 'POP']);
    prim.setPopups(null, new Set());
    prim.set([pin, over], ['n'], null);
    expect(texts(prim)).toEqual(['OVER', 'POP']);
  });
  it('does not paint the popup of a note being edited', () => {
    const prim = make();
    prim.set([pin], ['n'], null, null, 'n');
    expect(texts(prim)).toEqual([]);
  });
  it('hits an open popup but not a closed one', () => {
    const prim = make();
    prim.set([pin], [], null);
    const inPopup = { x: 10 + 8 + 6 + 12, y: 80 };
    expect(prim.hit(inPopup)).toBeNull();
    prim.setPopups(null, new Set(['n']));
    expect(prim.hit(inPopup)).toEqual({ id: 'n', handle: null });
  });
});
