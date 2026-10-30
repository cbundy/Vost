import { describe, expect, it } from 'vitest';
import { resolveStyle } from '../../../lib/drawingStyle';
import { fibCircles } from './fibCircles';
import { fibRetracement } from './fibRetracement';
import { drawLevelLabel, enabledLevels, levelLabel } from './fibLevels';
import { fibSpeedArcs } from './fibSpeedArcs';
import { fibSpeedFan } from './fibSpeedFan';
import { fibSpiral } from './fibSpiral';
import { fibTimeZone } from './fibTimeZone';
import { TOOLS } from './index';
import type { DrawingTool, ToolView } from './types';

const W = 600;
const H = 400;
function view(tool: DrawingTool, over: Record<string, unknown> = {}, anchors: ToolView['anchors'] = []): ToolView {
  return {
    width: W,
    height: H,
    anchors,
    text: '',
    times: [],
    candles: [],
    priceToY: (p) => H - p,
    formatPrice: (p) => `$${p}`,
    style: resolveStyle(tool.settings ?? [], over, undefined).values,
    styled: false,
    glyph: '',
    cells: [],
  };
}

/** A context that records every call and property write. */
function stub() {
  const calls: { name: string; args: unknown[] }[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => void calls.push({ name: k, args })),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const NEW = [fibTimeZone, fibSpeedFan, fibCircles, fibSpiral, fibSpeedArcs];
const A = { x: 100, y: 200 };
const B = { x: 200, y: 100 };

describe('registry', () => {
  it('lists the eleven Fibonacci tools in TradingView order, in the Fibonacci section', () => {
    const fib = TOOLS.filter((t) => t.section === 'Fibonacci').map((t) => t.id);
    expect(fib).toEqual(['fibRetracement', 'fibExtension', 'fibChannel', 'fibTimeZone', 'fibSpeedFan', 'fibTrendTime', 'fibCircles', 'fibSpiral', 'fibSpeedArcs', 'fibWedge', 'pitchfan']);
    for (const t of NEW) {
      expect(t.section).toBe('Fibonacci');
      expect(t.anchors).toBe(2);
      expect(t.handles([A, B], view(t))).toEqual([A, B]);
    }
  });
});

describe('degenerate input', () => {
  it('draws and hits without throwing for equal points, one point or none', () => {
    const same = [{ x: 50, y: 50 }, { x: 50, y: 50 }];
    for (const t of NEW) {
      for (const pts of [same, [A], []]) {
        const { ctx } = stub();
        expect(() => t.draw(ctx, pts, view(t), { selected: true })).not.toThrow();
        expect(() => t.hit(pts, { x: 50, y: 50 }, view(t))).not.toThrow();
      }
    }
    expect(fibCircles.hit(same, { x: 50, y: 50 }, view(fibCircles))).toBe(false);
    expect(fibSpiral.hit(same, { x: 50, y: 50 }, view(fibSpiral))).toBe(false);
  });
});

describe('fib time zone', () => {
  const pts = [{ x: 100, y: 200 }, { x: 120, y: 100 }];
  const v = view(fibTimeZone);
  it('is hit on a Fibonacci line only', () => {
    expect(fibTimeZone.hit(pts, { x: 100, y: 5 }, v)).toBe(true);
    expect(fibTimeZone.hit(pts, { x: 100 + 20 * 5, y: 390 }, v)).toBe(true);
    expect(fibTimeZone.hit(pts, { x: 100 + 20 * 4, y: 390 }, v)).toBe(false);
    expect(fibTimeZone.hit(pts, { x: 110, y: 100 }, v)).toBe(false);
  });
  it('does not hit lines that are switched off or outside the pane', () => {
    const levels = [{ value: 0, on: true, color: 'accent' }, { value: 2, on: false, color: 'accent' }, { value: 89, on: true, color: 'accent' }];
    const off = view(fibTimeZone, { levels });
    expect(fibTimeZone.hit(pts, { x: 140, y: 100 }, off)).toBe(false);
    expect(fibTimeZone.hit(pts, { x: 100 + 20 * 89, y: 100 }, off)).toBe(false);
  });
  it('hits the gaps only with the background on', () => {
    expect(fibTimeZone.hit(pts, { x: 130, y: 100 }, view(fibTimeZone, { background: true }))).toBe(true);
  });
  it('draws a line per level inside the pane, full height', () => {
    const { ctx, calls } = stub();
    fibTimeZone.draw(ctx, pts, v, { selected: false });
    const verticals = calls.filter((c, i) => c.name === 'moveTo' && c.args[1] === 0 && calls[i + 1].args[1] === H);
    // 0 1 2 3 5 8 13 21 -> x up to 520; 34 is at 780, outside
    expect(verticals.map((c) => c.args[0])).toEqual([100, 120, 140, 160, 200, 260, 360, 520]);
  });
  it('labels the time axis with the level times only while selected', () => {
    const times = [1000, 1060, 1120, 1180];
    const anchors = [{ time: 1000, price: 1 }, { time: 1060, price: 2 }];
    const style = v.style;
    expect(fibTimeZone.axisLabels!(anchors, style, false, times)).toEqual({});
    const got = fibTimeZone.axisLabels!(anchors, style, true, times);
    expect(got.time).toHaveLength(11);
    expect(got.time!.slice(0, 5)).toEqual([1000, 1060, 1120, 1180, 1300]);
    expect(fibTimeZone.axisLabels!(anchors, style, true, [])).toEqual({});
    expect(fibTimeZone.axisLabels!(anchors.slice(0, 1), style, true, times)).toEqual({});
  });
  it('is full height', () => {
    expect(fibTimeZone.fullHeight).toBe(true);
  });
});

describe('fib speed resistance fan', () => {
  const pts = [{ x: 100, y: 300 }, { x: 300, y: 100 }];
  const v = view(fibSpeedFan);
  it('is hit on a fan line, away from it not', () => {
    // price level 0.5: from (100,300) to (300, 200); at x 200 y is 250
    expect(fibSpeedFan.hit(pts, { x: 200, y: 250 }, v)).toBe(true);
    // diagonal
    expect(fibSpeedFan.hit(pts, { x: 200, y: 200 }, v)).toBe(true);
    expect(fibSpeedFan.hit(pts, { x: 350, y: 350 }, v)).toBe(false);
    expect(fibSpeedFan.hit(pts, { x: 50, y: 50 }, v)).toBe(false);
  });
  it('hits fills between lines only with the background on, grid lines only with the grid on', () => {
    const between = { x: 280, y: 245 }; // between price lines 0.382 and 0.5 near their ends, off the lines
    const bare = view(fibSpeedFan, { background: false, showGrid: false });
    expect(fibSpeedFan.hit(pts, between, bare)).toBe(false);
    expect(fibSpeedFan.hit(pts, between, view(fibSpeedFan, { background: true, showGrid: false }))).toBe(true);
    // grid line y = 200 (price 0.5) at x=250 is off every fan line but on the grid
    const g = { x: 295, y: 200 };
    expect(fibSpeedFan.hit(pts, g, view(fibSpeedFan, { background: false, showGrid: true }))).toBe(true);
    expect(fibSpeedFan.hit(pts, { x: 150, y: 150 }, bare)).toBe(false);
  });
  it('reverses the levels', () => {
    const r = view(fibSpeedFan, { reverse: true, background: false, showGrid: false });
    // reversed price level 0.25 ends at y = 100 + (300-100)*0.25 = 150
    expect(fibSpeedFan.hit(pts, { x: 300, y: 150 }, r)).toBe(true);
    expect(fibSpeedFan.hit(pts, { x: 300, y: 250 }, r)).toBe(true);
  });
  it('draws the four label sides when on, and none when off', () => {
    const texts = (over: Record<string, unknown>) => {
      const { ctx, calls } = stub();
      fibSpeedFan.draw(ctx, pts, view(fibSpeedFan, over), { selected: false });
      return calls.filter((c) => c.name === 'fillText').length;
    };
    expect(texts({})).toBe(7 * 4);
    expect(texts({ labelsLeft: false, labelsRight: false, labelsTop: false, labelsBottom: false })).toBe(0);
    expect(texts({ labelsLeft: false, labelsTop: false, labelsBottom: false })).toBe(7);
  });
});

describe('fib circles', () => {
  // centre (150, 150), radius through both points is about 70.7
  const pts = [{ x: 100, y: 100 }, { x: 200, y: 200 }];
  const r1 = Math.hypot(100, 100) / 2;
  it('is hit on a circle and not between circles without the background', () => {
    const v = view(fibCircles, { background: false });
    expect(fibCircles.hit(pts, { x: 150 + r1, y: 150 }, v)).toBe(true);
    expect(fibCircles.hit(pts, { x: 150, y: 150 - r1 * 0.5 }, v)).toBe(true);
    expect(fibCircles.hit(pts, { x: 150, y: 150 - r1 * 0.9 }, v)).toBe(false);
    expect(fibCircles.hit(pts, { x: 150, y: 150 }, v)).toBe(false);
    expect(fibCircles.hit(pts, { x: 150 + r1 * 4.236 + 40, y: 150 }, v)).toBe(false);
  });
  it('hits the filled area with the background on', () => {
    const v = view(fibCircles, { background: true });
    expect(fibCircles.hit(pts, { x: 150, y: 150 }, v)).toBe(true);
    expect(fibCircles.hit(pts, { x: 150 + r1 * 3, y: 150 }, v)).toBe(true);
    expect(fibCircles.hit(pts, { x: 150 + r1 * 4.236 + 40, y: 150 }, v)).toBe(false);
  });
  it('draws one circle per level that is on', () => {
    const { ctx, calls } = stub();
    fibCircles.draw(ctx, pts, view(fibCircles, { background: false }), { selected: false });
    const radii = calls.filter((c) => c.name === 'arc').map((c) => c.args[2] as number);
    expect(radii).toHaveLength(10);
    expect(radii[5]).toBeCloseTo(r1);
    expect(radii[0]).toBeCloseTo(r1 * 0.236);
  });
});

describe('fib spiral', () => {
  const pts = [{ x: 300, y: 200 }, { x: 340, y: 200 }];
  it('is hit on the curve through the second point and not away from it', () => {
    const v = view(fibSpiral);
    expect(fibSpiral.hit(pts, pts[1], v)).toBe(true);
    // a quarter turn on (clockwise on screen: down), the radius is 40 * golden ratio
    const quarter = { x: 300, y: 200 + 40 * 1.618034 };
    expect(fibSpiral.hit(pts, quarter, v)).toBe(true);
    expect(fibSpiral.hit(pts, { x: 300, y: 200 - 40 * 1.618034 }, v)).toBe(false);
    expect(fibSpiral.hit(pts, { x: 500, y: 50 }, v)).toBe(false);
  });
  it('flips with the counter-clockwise toggle', () => {
    const v = view(fibSpiral, { counterClockwise: true });
    expect(fibSpiral.hit(pts, { x: 300, y: 200 - 40 * 1.618034 }, v)).toBe(true);
    expect(fibSpiral.hit(pts, { x: 300, y: 200 + 40 * 1.618034 }, v)).toBe(false);
  });
  it('draws one polyline', () => {
    const { ctx, calls } = stub();
    fibSpiral.draw(ctx, pts, view(fibSpiral), { selected: false });
    expect(calls.filter((c) => c.name === 'lineTo').length).toBeGreaterThan(50);
  });
});

describe('fib speed resistance arcs', () => {
  const pts = [{ x: 100, y: 200 }, { x: 200, y: 200 }]; // pointing right
  it('is hit on the half circle on the second point side only', () => {
    const v = view(fibSpeedArcs, { background: false });
    expect(fibSpeedArcs.hit(pts, { x: 200, y: 200 }, v)).toBe(true);
    expect(fibSpeedArcs.hit(pts, { x: 100, y: 200 - 100 }, v)).toBe(true);
    expect(fibSpeedArcs.hit(pts, { x: 0, y: 200 }, v)).toBe(false);
    expect(fibSpeedArcs.hit(pts, { x: 100 - 61.8, y: 200 }, v)).toBe(false);
    expect(fibSpeedArcs.hit(pts, { x: 131, y: 200 }, v)).toBe(false);
  });
  it('is hit on the far side with full circles', () => {
    const v = view(fibSpeedArcs, { background: false, fullCircles: true });
    expect(fibSpeedArcs.hit(pts, { x: 100 - 61.8, y: 200 }, v)).toBe(true);
  });
  it('hits the filled area with the background on, on its half only', () => {
    const v = view(fibSpeedArcs, { background: true });
    expect(fibSpeedArcs.hit(pts, { x: 150, y: 200 }, v)).toBe(true);
    expect(fibSpeedArcs.hit(pts, { x: 50, y: 200 }, v)).toBe(false);
    expect(fibSpeedArcs.hit(pts, { x: 50, y: 200 }, view(fibSpeedArcs, { background: true, fullCircles: true }))).toBe(true);
  });
  it('draws half circles, or full ones', () => {
    const arcs = (over: Record<string, unknown>) => {
      const { ctx, calls } = stub();
      fibSpeedArcs.draw(ctx, pts, view(fibSpeedArcs, { background: false, ...over }), { selected: false });
      return calls.filter((c) => c.name === 'arc');
    };
    const half = arcs({});
    expect(half).toHaveLength(6);
    expect((half[0].args[4] as number) - (half[0].args[3] as number)).toBeCloseTo(Math.PI);
    expect(half[5].args[2]).toBeCloseTo(100);
    const full = arcs({ fullCircles: true });
    expect((full[0].args[4] as number) - (full[0].args[3] as number)).toBeCloseTo(Math.PI * 2);
  });
});

describe('shared level helpers', () => {
  it('lists the levels that are on, ordered by value', () => {
    const style = { levels: [{ value: 1, on: true, color: 'a' }, { value: 0.5, on: false, color: 'b' }, { value: 0, on: true, color: 'c' }] };
    expect(enabledLevels(style).map((l) => l.value)).toEqual([0, 1]);
    expect(enabledLevels(style, 'other')).toEqual([]);
  });
  it('builds the retracement labels', () => {
    expect(levelLabel(0.5, '$150', true, true)).toBe('0.5 ($150)');
    expect(levelLabel(0.5, '$150', true, false)).toBe('0.5');
    expect(levelLabel(0.5, '$150', false, true)).toBe('$150');
    expect(levelLabel(0.5, undefined, false, true)).toBe('0.5');
  });
  it('draws the retracement labels as before', () => {
    const { ctx, calls } = stub();
    const v = view(fibRetracement, {}, [{ time: 1, price: 100 }, { time: 2, price: 200 }]);
    fibRetracement.draw(ctx, [{ x: 100, y: 300 }, { x: 300, y: 200 }], v, { selected: false });
    const labels = calls.filter((c) => c.name === 'fillText');
    expect(labels.map((c) => c.args[0])).toEqual(['0 ($200)', '0.236 ($176.4)', '0.382 ($161.8)', '0.5 ($150)', '0.618 ($138.2)', '0.786 ($121.39999999999999)', '1 ($100)']);
    expect(labels[0].args.slice(1)).toEqual([104, 198]);
    const s = stub();
    drawLevelLabel(s.ctx, 'x', 5, 6, 'right', 'top');
    expect(s.calls).toEqual([{ name: 'fillText', args: ['x', 5, 6] }]);
  });
});
