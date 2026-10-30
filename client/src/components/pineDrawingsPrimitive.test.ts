import { describe, expect, it, vi } from 'vitest';
import type { PineDrawings } from '../lib/pine/types';
import { PineDrawingsPrimitive } from './pineDrawingsPrimitive';

const data: PineDrawings = {
  lines: [{ pane: 'separate' as const, time1: 1, price1: 5, time2: 2, price2: 9, extend: 'none' as const, color: '#FF0000', style: 'solid' as const, arrows: 'none' as const, width: 1 }],
  boxes: [], polylines: [], linefills: [], labels: [], tables: [],
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

const label = (o: Record<string, unknown> = {}) => ({
  pane: 'price' as const, time: 2, price: 10, yloc: 'price' as const, text: 'Hi', style: 'label_down', color: '#FF0000', textColor: '#FFFFFF',
  textSize: 12, textAlign: 'center' as const, tooltip: '', bold: false, italic: false, monospace: false, ...o,
});
const cell = (o: Record<string, unknown> = {}) => ({
  text: 'x', textColor: '#FFFFFF', bgColor: null, textSize: 12, halign: 'center' as const, valign: 'center' as const, widthPct: 0, heightPct: 0,
  tooltip: '', bold: false, italic: false, monospace: false, hidden: false, ...o,
});

/** A primitive attached to a fake chart that puts every bar at x = 100 * logical and every price at y = 200 - price. */
function painted(drawings: Partial<PineDrawings>) {
  const prim = new PineDrawingsPrimitive(() => [1, 2], false);
  const requestUpdate = vi.fn();
  prim.attached({
    chart: { timeScale: () => ({ logicalToCoordinate: (l: number) => 100 * l }) },
    series: { priceToCoordinate: (p: number) => 200 - p, getPane: () => ({ paneIndex: () => 1 }) },
    requestUpdate,
  } as never);
  prim.setData({ ...data, lines: [], ...drawings });
  requestUpdate.mockClear();
  const ctx = new Proxy({ measureText: (s: string) => ({ width: 6 * s.length }) } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : () => {}),
    set: () => true,
  });
  const view = prim.paneViews()[0].renderer()!;
  view.draw({ useMediaCoordinateSpace: (cb: (s: unknown) => void) => cb({ context: ctx, mediaSize: { width: 800, height: 400 } }) } as never);
  return { prim, requestUpdate };
}

describe('PineDrawingsPrimitive labels and tables', () => {
  it('never answers a hit test with labels and tables set', () => {
    const { prim } = painted({ labels: [label()], tables: [] });
    expect(prim.hitTest()).toBeNull();
  });

  it('asks for a repaint when the pointer is over a label with a tooltip, and not over one without', () => {
    // The label's anchor is at x 100 * 1, y 190 (bar index 1 for time 2); the bubble sits above it.
    const withTip = painted({ labels: [label({ tooltip: 'Why' })] });
    withTip.prim.setHover({ x: 100, y: 170 });
    expect(withTip.requestUpdate).toHaveBeenCalledTimes(1);
    withTip.prim.setHover({ x: 700, y: 20 });
    expect(withTip.requestUpdate).toHaveBeenCalledTimes(2); // the tooltip goes away
    withTip.prim.setHover({ x: 700, y: 30 });
    expect(withTip.requestUpdate).toHaveBeenCalledTimes(2); // nothing to repaint
    const plain = painted({ labels: [label()] });
    plain.prim.setHover({ x: 100, y: 170 });
    expect(plain.requestUpdate).not.toHaveBeenCalled();
  });

  it('shows a table cell tooltip over the cell only, and hides it when the pointer leaves the pane', () => {
    const table = {
      pane: 'price' as const, position: 'top_left' as const, columns: 1, rows: 1, bgColor: null, frameColor: null, frameWidth: 0,
      borderColor: null, borderWidth: 0, cells: [[cell({ tooltip: 'Cell tip' })]], merges: [],
    };
    const { prim, requestUpdate } = painted({ tables: [table] });
    prim.setHover({ x: 8, y: 8 }); // inside the 4 px inset
    expect(requestUpdate).toHaveBeenCalledTimes(1);
    prim.setHover(null);
    expect(requestUpdate).toHaveBeenCalledTimes(2);
  });

  it('takes the crosshair only from its own pane', () => {
    const { prim, requestUpdate } = painted({ labels: [label({ tooltip: 'Why' })] });
    prim.crosshairMoved(0, { x: 100, y: 170 });
    expect(requestUpdate).not.toHaveBeenCalled();
    prim.crosshairMoved(1, { x: 100, y: 170 });
    expect(requestUpdate).toHaveBeenCalledTimes(1);
  });
});
