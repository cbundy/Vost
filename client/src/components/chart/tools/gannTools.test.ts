import { describe, expect, it } from 'vitest';
import { resolveStyle } from '../../../lib/drawingStyle';
import { gannBox } from './gannBox';
import { gannFan } from './gannFan';
import { gannSquare } from './gannSquare';
import { gannSquareFixed } from './gannSquareFixed';
import { TOOLS } from './index';
import type { DrawingTool, ToolView } from './types';

const W = 600;
const H = 400;
function view(tool: DrawingTool, over: Record<string, unknown> = {}): ToolView {
  return {
    width: W,
    height: H,
    anchors: [],
    text: '',
    times: [],
    candles: [],
    priceToY: (p) => H - p,
    formatPrice: (p) => `$${p}`,
    style: resolveStyle(tool.settings ?? [], over, undefined).values,
    styled: false,
  };
}
function stub() {
  const props: Record<string, unknown> = {};
  return new Proxy(props, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
}

const GANN = [gannBox, gannSquareFixed, gannSquare, gannFan];
const A = { x: 100, y: 300 };
const B = { x: 200, y: 200 };
const NONE = { fans: [], arcs: [], levels: [] };

describe('registry', () => {
  it('lists the four tools after the Fibonacci tools, in the Gann section of the family', () => {
    const ids = TOOLS.map((t) => t.id);
    expect(ids.slice(ids.indexOf('fibSpeedArcs') + 1, ids.indexOf('fibSpeedArcs') + 5)).toEqual(['gannBox', 'gannSquareFixed', 'gannSquare', 'gannFan']);
    for (const t of GANN) {
      expect(t.section).toBe('Gann');
      expect(t.group).toBe('fib-gann');
      expect(t.anchors).toBe(2);
    }
  });
});

describe('degenerate input', () => {
  it('draws and hits without throwing for equal points, one point or none', () => {
    const same = [{ x: 50, y: 50 }, { x: 50, y: 50 }];
    for (const t of GANN) {
      for (const pts of [same, [A], []]) {
        expect(() => t.draw(stub(), pts, view(t), { selected: true })).not.toThrow();
        expect(() => t.hit(pts, { x: 50, y: 50 }, view(t))).not.toThrow();
        expect(() => t.handles(pts, view(t))).not.toThrow();
      }
    }
  });
});

describe('axis labels', () => {
  it('returns the anchors only when selected', () => {
    const anchors = [{ time: 1, price: 10 }, { time: 2, price: 20 }];
    for (const t of GANN) {
      expect(t.axisLabels!(anchors, {}, true)).toEqual({ price: [10, 20], time: [1, 2] });
      expect(t.axisLabels!(anchors, {}, false)).toEqual({});
    }
  });
});

describe('gann box', () => {
  const v = view(gannBox);
  it('is hit on a level line, a diagonal and a fill, not away from them', () => {
    expect(gannBox.hit([A, B], { x: 113, y: 268 }, view(gannBox, { background: false, angles: false }), 2)).toBe(false);
    expect(gannBox.hit([A, B], { x: 150, y: 220 }, v)).toBe(true); // in a band
    expect(gannBox.hit([A, B], { x: 150, y: 200 }, view(gannBox, { background: false }))).toBe(true); // top line
    expect(gannBox.hit([A, B], { x: 160, y: 240 }, view(gannBox, { background: false, priceLevels: [], timeLevels: [] }))).toBe(true); // diagonal
    expect(gannBox.hit([A, B], { x: 300, y: 250 }, v)).toBe(false);
  });
  it('does not hit a level that is off', () => {
    const table = (resolveStyle(gannBox.settings!, {}, undefined).values.priceLevels as { value: number; color: string; on: boolean }[]).map((l) => ({ ...l, on: l.value !== 0.5 }));
    const style = { background: false, angles: false, priceLevels: table, timeLevels: [] };
    expect(gannBox.hit([A, B], { x: 150, y: 250 }, view(gannBox, style))).toBe(false);
    expect(gannBox.hit([A, B], { x: 150, y: 275 }, view(gannBox, style))).toBe(true);
  });
  it('has the four corners then the four side midpoints as handles', () => {
    expect(gannBox.handles([A, B], v)).toEqual([
      { x: 100, y: 200 }, { x: 200, y: 200 }, { x: 200, y: 300 }, { x: 100, y: 300 },
      { x: 150, y: 200 }, { x: 200, y: 250 }, { x: 150, y: 300 }, { x: 100, y: 250 },
    ]);
  });
  it('moves only one side with a side handle and keeps the opposite corner for a corner handle', () => {
    expect(gannBox.dragHandle!([A, B], 4, { x: 170, y: 150 })).toEqual([{ x: 100, y: 150 }, { x: 200, y: 300 }]);
    expect(gannBox.dragHandle!([A, B], 5, { x: 260, y: 90 })).toEqual([{ x: 100, y: 200 }, { x: 260, y: 300 }]);
    expect(gannBox.dragHandle!([A, B], 6, { x: 0, y: 340 })).toEqual([{ x: 100, y: 200 }, { x: 200, y: 340 }]);
    expect(gannBox.dragHandle!([A, B], 7, { x: 60, y: 0 })).toEqual([{ x: 60, y: 200 }, { x: 200, y: 300 }]);
    expect(gannBox.dragHandle!([A, B], 0, { x: 50, y: 150 })).toEqual([{ x: 200, y: 300 }, { x: 50, y: 150 }]);
  });
});

describe('gann fan', () => {
  const v = view(gannFan, { background: false });
  it('is hit on a line, past point 2 up to the pane edge, and not between lines', () => {
    expect(gannFan.hit([A, B], { x: 150, y: 250 }, v)).toBe(true); // 1x1
    expect(gannFan.hit([A, B], { x: 400, y: 0 }, v)).toBe(true); // 1x1 continues
    expect(gannFan.hit([A, B], { x: 150, y: 235 }, v)).toBe(false); // between 1x1 and 2x1
    expect(gannFan.hit([A, B], { x: 150, y: 235 }, view(gannFan))).toBe(true); // in a fill
  });
  it('is not hit on a line that is off', () => {
    const levels = (resolveStyle(gannFan.settings!, {}, undefined).values.levels as { value: number; color: string; on: boolean }[]).map((l) => ({ ...l, on: l.value !== 1 }));
    expect(gannFan.hit([A, B], { x: 150, y: 250 }, view(gannFan, { background: false, levels }))).toBe(false);
  });
  it('has the two points as handles', () => {
    expect(gannFan.handles([A, B], v)).toEqual([A, B]);
  });
});

describe('gann squares', () => {
  it('keeps the fixed square square in handles and drags', () => {
    const b = { x: 250, y: 220 };
    expect(gannSquareFixed.handles([A, b], view(gannSquareFixed))).toEqual([A, { x: 250, y: 150 }]);
    expect(gannSquare.handles([A, b], view(gannSquare))).toEqual([A, b]);
    expect(gannSquareFixed.dragHandle!([A, b], 1, { x: 180, y: 50 })).toEqual([A, { x: 350, y: 50 }]);
    expect(gannSquareFixed.dragHandle!([A, b], 0, { x: 10, y: 20 })).toEqual([{ x: 10, y: 20 }, b]);
  });
  it('is hit on its border, grid, fan, arc and fill, and not outside', () => {
    const base = { background: false, ...NONE };
    const sq = view(gannSquare, { ...base, levels: [{ value: 0.5, color: 'accent', on: true }] });
    expect(gannSquare.hit([A, B], { x: 100, y: 250 }, sq)).toBe(true); // border
    expect(gannSquare.hit([A, B], { x: 150, y: 270 }, sq)).toBe(true); // grid line x = 150
    expect(gannSquare.hit([A, B], { x: 130, y: 270 }, sq)).toBe(false);
    const fan = view(gannSquare, { ...base, fans: [{ value: 1, color: 'accent', on: true }] });
    expect(gannSquare.hit([A, B], { x: 130, y: 270 }, fan)).toBe(true);
    const arc = view(gannSquare, { ...base, arcs: [{ value: 1, color: 'accent', on: true }] });
    expect(gannSquare.hit([A, B], { x: 100 + 100 * Math.cos(Math.PI / 4), y: 300 - 100 * Math.sin(Math.PI / 4) }, arc)).toBe(true);
    expect(gannSquare.hit([A, B], { x: 130, y: 270 }, view(gannSquare, { ...base, arcs: [{ value: 1, color: 'accent', on: false }] }))).toBe(false);
    expect(gannSquare.hit([A, B], { x: 500, y: 20 }, view(gannSquare))).toBe(false);
    const filled = view(gannSquare, { fans: [{ value: 0.5, color: 'accent', on: true }, { value: 2, color: 'accent', on: true }], levels: [], arcs: [] });
    expect(gannSquare.hit([A, B], { x: 140, y: 255 }, filled)).toBe(true);
  });
});
