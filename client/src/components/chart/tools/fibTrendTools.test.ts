import { describe, expect, it } from 'vitest';
import { resolveStyle } from '../../../lib/drawingStyle';
import { percentLabel } from './fibExtension';
import { fibChannel } from './fibChannel';
import { fibExtension } from './fibExtension';
import { fibTrendTime } from './fibTrendTime';
import { fibWedge } from './fibWedge';
import { pitchfan } from './pitchfan';
import type { DrawingTool, ToolView } from './types';

const W = 600;
const H = 400;
const ANCHORS = [{ time: 1000, price: 100 }, { time: 2000, price: 150 }, { time: 3000, price: 120 }];
function view(tool: DrawingTool, over: Record<string, unknown> = {}, anchors: ToolView['anchors'] = ANCHORS, times: number[] = []): ToolView {
  return {
    width: W,
    height: H,
    anchors,
    text: '',
    times,
    candles: [],
    priceToY: (p) => H - p,
    formatPrice: (p) => `$${p}`,
    style: resolveStyle(tool.settings ?? [], over, undefined).values,
    styled: false,
    cells: [],
  };
}
function stub() {
  const calls: { name: string; args: unknown[] }[] = [];
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get: (t, k: string) => (k in t ? t[k] : (...args: unknown[]) => void calls.push({ name: k, args })),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
const TOOLS = [fibExtension, fibChannel, fibTrendTime, fibWedge, pitchfan];
// Pixels of the anchors: A (100, 300), B (200, 250), C (300, 280).
const PTS = [{ x: 100, y: 300 }, { x: 200, y: 250 }, { x: 300, y: 280 }];

describe('registration', () => {
  it('declares three anchors in the Fibonacci section and hands back the anchors as handles', () => {
    for (const t of TOOLS) {
      expect(t.anchors).toBe(3);
      expect(t.group).toBe('fib-gann');
      expect(t.section).toBe('Fibonacci');
      expect(t.handles(PTS, view(t))).toEqual(PTS);
    }
    expect(fibTrendTime.fullHeight).toBe(true);
  });
  it('labels selected drawings on the axes, except the trend time which shows its level times', () => {
    for (const t of [fibExtension, fibChannel, fibWedge, pitchfan]) {
      expect(t.axisLabels!(ANCHORS, {}, true)).toEqual({ price: [100, 150, 120], time: [1000, 2000, 3000] });
      expect(t.axisLabels!(ANCHORS, {}, false)).toEqual({});
    }
    const times = Array.from({ length: 10 }, (_, i) => 1000 * (i + 1));
    const style = { levels: [{ value: 0, on: true }, { value: 1, on: true }, { value: 2, on: false }] };
    expect(fibTrendTime.axisLabels!(ANCHORS, style, false, times)).toEqual({});
    // A at bar 0, B at bar 1, C at bar 2: line 0 at bar 2 (3000), line 1 at bar 3 (4000).
    expect(fibTrendTime.axisLabels!(ANCHORS, style, true, times)).toEqual({ time: [3000, 4000] });
    expect(fibTrendTime.axisLabels!(ANCHORS, style, true, [])).toEqual({});
  });
});

describe('degenerate input', () => {
  it('draws and hits without throwing for no points, one, two, coincident points and no bars', () => {
    const same = [{ x: 50, y: 50 }, { x: 50, y: 50 }, { x: 50, y: 50 }];
    for (const t of TOOLS) {
      for (const pts of [same, same.slice(0, 2), PTS.slice(0, 2), PTS.slice(0, 1), []]) {
        for (const anchors of [ANCHORS, [], ANCHORS.slice(0, pts.length)]) {
          const { ctx } = stub();
          expect(() => t.draw(ctx, pts, view(t, {}, anchors), { selected: true })).not.toThrow();
          expect(() => t.hit(pts, { x: 50, y: 50 }, view(t, {}, anchors))).not.toThrow();
        }
      }
    }
  });
  it('two points draw the A-B segment and hit on it', () => {
    for (const t of TOOLS) {
      const { ctx, calls } = stub();
      t.draw(ctx, PTS.slice(0, 2), view(t, {}, ANCHORS.slice(0, 2)), { selected: false });
      expect(calls.some((c) => c.name === 'lineTo' || c.name === 'stroke'), t.id).toBe(true);
      expect(t.hit(PTS.slice(0, 2), { x: 150, y: 275 }, view(t, {}, ANCHORS.slice(0, 2))), t.id).toBe(true);
      expect(t.hit(PTS.slice(0, 2), { x: 150, y: 335 }, view(t, {}, ANCHORS.slice(0, 2))), t.id).toBe(false);
    }
  });
});

describe('Trend-based fib extension', () => {
  const v = (over: Record<string, unknown> = {}) => view(fibExtension, over);
  // Level 1 is at price 120 + 50 = 170 (y 230); level 0 at 120 (y 280). B-C x is 200..300.
  it('hits on a level line within the x range of B and C, not beyond it unless extended', () => {
    expect(fibExtension.hit(PTS, { x: 250, y: 230 }, v())).toBe(true);
    expect(fibExtension.hit(PTS, { x: 250, y: 300 }, v())).toBe(false);
    expect(fibExtension.hit(PTS, { x: 450, y: 230 }, v())).toBe(false);
    expect(fibExtension.hit(PTS, { x: 450, y: 230 }, v({ extendRight: true }))).toBe(true);
    expect(fibExtension.hit(PTS, { x: 20, y: 230 }, v({ extendLeft: true }))).toBe(true);
  });
  it('reverse measures the other way', () => {
    // reversed level 1 is 120 - 50 = 70 (y 330)
    expect(fibExtension.hit(PTS, { x: 250, y: 330 }, v({ reverse: true }))).toBe(true);
    expect(fibExtension.hit(PTS, { x: 250, y: 330 }, v())).toBe(false);
  });
  it('hits on the A-B-C path and in a fill only with Background on', () => {
    expect(fibExtension.hit(PTS, { x: 150, y: 275 }, v())).toBe(true);
    const inside = { x: 250, y: 215 }; // between levels 1 (y 230) and 1.618 (y 199)
    expect(fibExtension.hit(PTS, inside, v({ background: false }))).toBe(false);
    expect(fibExtension.hit(PTS, inside, v({ background: true }))).toBe(true);
  });
  it('labels with level, price and percent from C', () => {
    const { ctx, calls } = stub();
    fibExtension.draw(ctx, PTS, v({ showPercent: true }), { selected: false });
    const texts = calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]);
    expect(texts).toContain('1 ($170) +41.7%');
    expect(texts).toContain('0 ($120) +0.0%');
    expect(percentLabel(90, 120)).toBe('-25.0%');
    expect(percentLabel(5, 0)).toBe('');
  });
  it('shows no labels when all three text settings are off', () => {
    const { ctx, calls } = stub();
    fibExtension.draw(ctx, PTS, v({ showLevels: false, showPrices: false }), { selected: false });
    expect(calls.some((c) => c.name === 'fillText')).toBe(false);
  });
});

describe('Fib channel', () => {
  // A (100, 300), B (200, 300), C (150, 200): C is 100px above A-B, so level r is the line y = 300 - 100 r.
  const P = [{ x: 100, y: 300 }, { x: 200, y: 300 }, { x: 150, y: 200 }];
  const v = (over: Record<string, unknown> = {}) => view(fibChannel, over);
  it('hits on A-B, on level 0.5 and on level 1 through C, and not away from the lines', () => {
    expect(fibChannel.hit(P, { x: 150, y: 300 }, v())).toBe(true);
    expect(fibChannel.hit(P, { x: 150, y: 250 }, v())).toBe(true);
    expect(fibChannel.hit(P, { x: 150, y: 200 }, v())).toBe(true);
    expect(fibChannel.hit(P, { x: 130, y: 169 }, v({ background: false }))).toBe(false);
    expect(fibChannel.hit(P, { x: 150, y: 350 }, v())).toBe(false);
  });
  it('hits inside a band only with Background on', () => {
    const inside = { x: 150, y: 169 }; // between level 1 (y 200) and 1.618 (y 138)
    expect(fibChannel.hit(P, inside, v({ background: false }))).toBe(false);
    expect(fibChannel.hit(P, inside, v({ background: true }))).toBe(true);
  });
  it('continues the lines to the pane edges only when extended', () => {
    const far = { x: 400, y: 250 };
    expect(fibChannel.hit(P, far, v())).toBe(false);
    expect(fibChannel.hit(P, far, v({ extendRight: true }))).toBe(true);
    expect(fibChannel.hit(P, { x: 20, y: 250 }, v({ extendLeft: true }))).toBe(true);
  });
  it('draws a label per level only with Show levels', () => {
    const on = stub();
    fibChannel.draw(on.ctx, P, v(), { selected: false });
    expect(on.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0])).toContain('0.618');
    const off = stub();
    fibChannel.draw(off.ctx, P, v({ showLevels: false }), { selected: false });
    expect(off.calls.some((c) => c.name === 'fillText')).toBe(false);
  });
});

describe('Trend-based fib time', () => {
  const v = (over: Record<string, unknown> = {}) => view(fibTrendTime, over);
  // x_C + (x_B - x_A) * r = 300 + 100 r: line 1 at 400, 0.5 at 350.
  it('hits on a vertical line anywhere in the pane height and not 10px away', () => {
    expect(fibTrendTime.hit(PTS, { x: 400, y: 20 }, v())).toBe(true);
    expect(fibTrendTime.hit(PTS, { x: 350, y: 390 }, v())).toBe(true);
    expect(fibTrendTime.hit(PTS, { x: 410, y: 20 }, v())).toBe(false);
  });
  it('hits between lines only with Background on', () => {
    const p = { x: 380, y: 20 }; // between 0.618 (361.8)... and 1 (400)
    expect(fibTrendTime.hit(PTS, p, v({ background: false }))).toBe(false);
    expect(fibTrendTime.hit(PTS, p, v({ background: true }))).toBe(true);
  });
  it('labels the lines only with Show labels', () => {
    const on = stub();
    fibTrendTime.draw(on.ctx, PTS, v(), { selected: false });
    expect(on.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0])).toContain('1');
    const off = stub();
    fibTrendTime.draw(off.ctx, PTS, v({ showLabels: false }), { selected: false });
    expect(off.calls.some((c) => c.name === 'fillText')).toBe(false);
  });
});

describe('Fib wedge', () => {
  // Apex A (100, 300), B (200, 300) so the radius is 100, C (100, 200) straight up: the sweep is a quarter turn up.
  const P = [{ x: 100, y: 300 }, { x: 200, y: 300 }, { x: 100, y: 200 }];
  const v = (over: Record<string, unknown> = {}) => view(fibWedge, over);
  const at = (r: number, ang: number) => ({ x: 100 + r * Math.cos(ang), y: 300 + r * Math.sin(ang) });
  it('hits on both edges and on an arc inside the sweep, not on an arc outside it', () => {
    expect(fibWedge.hit(P, { x: 150, y: 300 }, v())).toBe(true);
    expect(fibWedge.hit(P, { x: 100, y: 250 }, v())).toBe(true);
    expect(fibWedge.hit(P, at(50, -Math.PI / 4), v())).toBe(true);
    expect(fibWedge.hit(P, at(50, Math.PI / 4), v())).toBe(false);
  });
  it('hits in a fill between arcs only with Background on', () => {
    const p = at(88, -Math.PI / 4); // between 0.786 and 1
    expect(fibWedge.hit(P, p, v({ background: false }))).toBe(false);
    expect(fibWedge.hit(P, p, v({ background: true }))).toBe(true);
    expect(fibWedge.hit(P, at(88, Math.PI / 4), v({ background: true }))).toBe(false);
  });
  it('draws one arc per enabled level and labels them only with Show labels', () => {
    const { ctx, calls } = stub();
    fibWedge.draw(ctx, P, v({ background: false }), { selected: false });
    expect(calls.filter((c) => c.name === 'arc')).toHaveLength(6);
    expect(calls.filter((c) => c.name === 'fillText').map((c) => c.args[0])).toContain('0.5');
    const off = stub();
    fibWedge.draw(off.ctx, P, v({ showLabels: false }), { selected: false });
    expect(off.calls.some((c) => c.name === 'fillText')).toBe(false);
  });
});

describe('Pitchfan', () => {
  // A (100, 300), B (300, 200), C (300, 300): M is (300, 250); level 1 is A-B and A-C, level 0.5 ends at (300, 225) and (300, 275).
  const P = [{ x: 100, y: 300 }, { x: 300, y: 200 }, { x: 300, y: 300 }];
  const v = (over: Record<string, unknown> = {}) => view(pitchfan, over);
  it('hits on the median, on a level line and on the B-C segment, not 10px off', () => {
    expect(pitchfan.hit(P, { x: 200, y: 275 }, v())).toBe(true); // median
    expect(pitchfan.hit(P, { x: 200, y: 250 }, v())).toBe(true); // A-B
    expect(pitchfan.hit(P, { x: 300, y: 215 }, v())).toBe(true); // B-C
    expect(pitchfan.hit(P, { x: 200, y: 320 }, v({ background: false }))).toBe(false);
    expect(pitchfan.hit(P, { x: 150, y: 330 }, v())).toBe(false);
  });
  it('hides the median hit with Median off', () => {
    expect(pitchfan.hit(P, { x: 200, y: 275 }, v({ showMedian: false, background: false }))).toBe(false);
  });
  it('stops at B-C unless Extend lines is on', () => {
    const onMedian = { x: 400, y: 225 };
    expect(pitchfan.hit(P, onMedian, v({ background: false }))).toBe(false);
    expect(pitchfan.hit(P, onMedian, v({ extendLines: true, background: false }))).toBe(true);
  });
  it('hits inside a fill only with Background on', () => {
    const p = { x: 290, y: 264 }; // between the median and level 0.5
    expect(pitchfan.hit(P, p, v({ background: false }))).toBe(false);
    expect(pitchfan.hit(P, p, v({ background: true }))).toBe(true);
  });
});
