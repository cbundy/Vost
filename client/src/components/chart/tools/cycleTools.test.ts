import { describe, expect, it } from 'vitest';
import { resolveStyle } from '../../../lib/drawingStyle';
import { cyclicLines } from './cyclicLines';
import { sineLine } from './sineLine';
import { timeCycles } from './timeCycles';
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
    formatPrice: String,
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

const A = { x: 100, y: 300 };
const B = { x: 200, y: 200 };
const TOOLS = [cyclicLines, timeCycles, sineLine];

describe('the cycle tools', () => {
  it('sit in the Patterns family, section Cycles, with two anchors', () => {
    expect(TOOLS.map((t) => [t.id, t.group, t.section, t.anchors])).toEqual([
      ['cyclicLines', 'patterns', 'Cycles', 2],
      ['timeCycles', 'patterns', 'Cycles', 2],
      ['sineLine', 'patterns', 'Cycles', 2],
    ]);
    expect(cyclicLines.fullHeight).toBe(true);
  });

  for (const tool of TOOLS) {
    describe(tool.id, () => {
      it('has handles on the two anchors', () => {
        expect(tool.handles([A, B], view(tool))).toEqual([A, B]);
      });
      it('draws without throwing, also with no distance or one point', () => {
        for (const pts of [[A, B], [A, { x: A.x, y: 50 }], [A, A], [A], []]) expect(() => tool.draw(stub(), pts, view(tool), { selected: true })).not.toThrow();
      });
      it('hits nothing with zero horizontal distance', () => {
        expect(tool.hit([A, { x: A.x, y: 50 }], { x: A.x, y: 100 }, view(tool))).toBe(false);
      });
      it('labels the axis without throwing for no or one bar', () => {
        const anchors = [{ time: 100, price: 1 }, { time: 200, price: 2 }];
        expect(() => tool.axisLabels?.(anchors, {}, true, [])).not.toThrow();
        expect(() => tool.axisLabels?.(anchors, {}, true, [100])).not.toThrow();
        expect(tool.axisLabels?.(anchors, {}, false, [100, 200])).toEqual({});
      });
    });
  }

  it('cyclic lines hit on a repeat in both directions and miss between', () => {
    const v = view(cyclicLines);
    for (const x of [0, 100, 200, 300, 500]) expect(cyclicLines.hit([A, B], { x, y: 10 }, v)).toBe(true);
    expect(cyclicLines.hit([A, B], { x: 150, y: 10 }, v)).toBe(false);
    expect(cyclicLines.hit([B, A], { x: 150, y: 10 }, v)).toBe(false);
  });

  it('time cycles hit on an arc and miss between and past it (fill off)', () => {
    const v = view(timeCycles, { background: false });
    // arcs sit on y=300, bulge to y=200 over 100..200, 200..300 and so on
    expect(timeCycles.hit([A, B], { x: 150, y: 200 }, v)).toBe(true);
    expect(timeCycles.hit([A, B], { x: 250, y: 200 }, v)).toBe(true);
    expect(timeCycles.hit([A, B], { x: 50, y: 200 }, v)).toBe(true);
    expect(timeCycles.hit([A, B], { x: 150, y: 250 }, v)).toBe(false);
    expect(timeCycles.hit([A, B], { x: 150, y: 120 }, v)).toBe(false);
  });

  it('time cycles hit inside an arc only when the fill is on', () => {
    expect(timeCycles.hit([A, B], { x: 150, y: 250 }, view(timeCycles, { background: true }))).toBe(true);
    expect(timeCycles.hit([A, B], { x: 150, y: 350 }, view(timeCycles, { background: true }))).toBe(false);
  });

  it('the sine line hits on the curve at the extremes and the middle, and misses off it', () => {
    const v = view(sineLine);
    expect(sineLine.hit([A, B], A, v)).toBe(true);
    expect(sineLine.hit([A, B], B, v)).toBe(true);
    expect(sineLine.hit([A, B], { x: 150, y: 250 }, v)).toBe(true);
    expect(sineLine.hit([A, B], { x: 250, y: 250 }, v)).toBe(true);
    expect(sineLine.hit([A, B], { x: 150, y: 150 }, v)).toBe(false);
    expect(sineLine.hit([A, B], { x: 100, y: 100 }, v)).toBe(false);
  });
});
