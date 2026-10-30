import { describe, expect, it } from 'vitest';
import { resolveStyle } from '../../../lib/drawingStyle';
import { crossLine } from './crossLine';
import { horizontalLine } from './horizontalLine';
import { horizontalRay } from './horizontalRay';
import { TOOLS } from './index';
import { infoLine } from './infoLine';
import { extendedLine } from './extendedLine';
import { trendAngle } from './trendAngle';
import type { DrawingTool, ToolView } from './types';
import { verticalLine } from './verticalLine';

const W = 400;
const H = 300;
function view(tool: DrawingTool, anchors: ToolView['anchors'] = []): ToolView {
  return {
    width: W,
    height: H,
    anchors,
    text: '',
    times: [],
    candles: [],
    priceToY: () => null,
    formatPrice: String,
    style: resolveStyle(tool.settings ?? [], undefined, undefined).values,
    styled: false,
    cells: [],
  };
}
const A = { time: 100, price: 10 };
const B = { time: 200, price: 20 };

describe('registry', () => {
  it('lists the lines in TradingView order', () => {
    expect(TOOLS.filter((t) => t.group === 'lines').map((t) => t.id)).toEqual([
      'trendLine', 'ray', 'infoLine', 'extendedLine', 'trendAngle', 'horizontalLine', 'horizontalRay', 'verticalLine', 'crossLine', 'parallelChannel', 'regressionTrend', 'flatTopBottom', 'disjointChannel', 'pitchfork', 'schiffPitchfork', 'modifiedSchiffPitchfork', 'insidePitchfork',
    ]);
  });
});

describe('two-anchor lines', () => {
  const pts = [{ x: 100, y: 200 }, { x: 200, y: 100 }];
  it('info line shows everything by default', () => {
    const s = view(infoLine).style;
    expect([s.showPriceChange, s.showBars, s.showAngle, s.showDistance, s.extendLeft, s.extendRight]).toEqual([true, true, true, true, false, false]);
    expect(infoLine.handles(pts, view(infoLine))).toEqual(pts);
  });
  it('info line is hit on its segment only', () => {
    const v = view(infoLine, [A, B]);
    expect(infoLine.hit(pts, { x: 150, y: 150 }, v)).toBe(true);
    expect(infoLine.hit(pts, { x: 150, y: 170 }, v)).toBe(false);
    expect(infoLine.hit(pts, { x: 300, y: 0 }, v)).toBe(false);
  });
  it('extended line extends both ways and is hit beyond its anchors', () => {
    const v = view(extendedLine, [A, B]);
    expect([v.style.extendLeft, v.style.extendRight]).toEqual([true, true]);
    expect(extendedLine.hit(pts, { x: 50, y: 250 }, v)).toBe(true);
    expect(extendedLine.hit(pts, { x: 250, y: 50 }, v)).toBe(true);
    expect(extendedLine.hit(pts, { x: 250, y: 100 }, v)).toBe(false);
  });
  it('trend angle is hit on the line and on its dotted reference, not away from both', () => {
    const v = view(trendAngle, [A, B]);
    expect(trendAngle.settings?.some((f) => f.key === 'showAngle')).toBe(false);
    expect(trendAngle.hit(pts, { x: 150, y: 150 }, v)).toBe(true);
    expect(trendAngle.hit(pts, { x: 180, y: 200 }, v)).toBe(true);
    expect(trendAngle.hit(pts, { x: 150, y: 250 }, v)).toBe(false);
    expect(trendAngle.handles(pts, v)).toHaveLength(2);
  });
  it('does not throw on equal anchors', () => {
    const same = [{ x: 50, y: 50 }, { x: 50, y: 50 }];
    for (const t of [infoLine, extendedLine, trendAngle]) {
      expect(() => t.hit(same, { x: 50, y: 50 }, view(t, [A, A]))).not.toThrow();
    }
  });
});

describe('one-anchor lines', () => {
  const a = [{ x: 150, y: 120 }];
  it('horizontal ray runs from its anchor to the right edge', () => {
    const v = view(horizontalRay, [A]);
    expect(horizontalRay.anchors).toBe(1);
    expect(horizontalRay.priceOnly).toBeUndefined();
    expect(horizontalRay.hit(a, { x: 300, y: 122 }, v)).toBe(true);
    expect(horizontalRay.hit(a, { x: 100, y: 120 }, v)).toBe(false);
    expect(horizontalRay.hit(a, { x: 300, y: 150 }, v)).toBe(false);
    expect(horizontalRay.hit([{ x: W + 50, y: 120 }], { x: 300, y: 120 }, v)).toBe(false);
  });
  it('vertical line is time-only and hit on its x anywhere in the pane', () => {
    const v = view(verticalLine, [A]);
    expect(verticalLine.timeOnly).toBe(true);
    expect(verticalLine.hit(a, { x: 151, y: 5 }, v)).toBe(true);
    expect(verticalLine.hit(a, { x: 170, y: 120 }, v)).toBe(false);
    expect(verticalLine.handles(a, v)).toEqual([{ x: 150, y: H / 2 }]);
  });
  it('cross line is hit on either line and keeps its handle in the pane', () => {
    const v = view(crossLine, [A]);
    expect(crossLine.hit(a, { x: 150, y: 10 }, v)).toBe(true);
    expect(crossLine.hit(a, { x: 10, y: 120 }, v)).toBe(true);
    expect(crossLine.hit(a, { x: 10, y: 10 }, v)).toBe(false);
    expect(crossLine.fullWidth && crossLine.fullHeight).toBe(true);
    const [h] = crossLine.handles([{ x: -500, y: 9000 }], v);
    expect(h.x).toBeGreaterThanOrEqual(0);
    expect(h.y).toBeLessThanOrEqual(H);
  });
  it('declares Style settings with a colour, opacity, width and line style', () => {
    for (const t of [infoLine, extendedLine, trendAngle, horizontalRay, verticalLine, crossLine]) {
      const keys = (t.settings ?? []).map((f) => f.key);
      expect(keys).toEqual(expect.arrayContaining(['color', 'opacity', 'width', 'lineStyle']));
    }
  });
});

describe('axis labels', () => {
  const style = { showLabel: true };
  it('shows the price and time of a selected cross line and nothing unselected', () => {
    expect(crossLine.axisLabels?.([A], {}, true)).toEqual({ price: [10], time: [100] });
    expect(crossLine.axisLabels?.([A], {}, false)).toEqual({});
  });
  it('labels a vertical line by time and a horizontal ray by price and time, when selected', () => {
    expect(verticalLine.axisLabels?.([A], {}, true)).toEqual({ time: [100] });
    expect(horizontalRay.axisLabels?.([A], {}, true)).toEqual({ price: [10], time: [100] });
    expect(infoLine.axisLabels?.([A, B], {}, true)).toEqual({ price: [10, 20], time: [100, 200] });
  });
  it('keeps the horizontal line price label as it was, selected or not, off with showLabel false', () => {
    expect(horizontalLine.axisLabels?.([A], style, false)).toEqual({ price: [10] });
    expect(horizontalLine.axisLabels?.([A], style, true)).toEqual({ price: [10] });
    expect(horizontalLine.axisLabels?.([A], { showLabel: false }, true)).toEqual({});
  });
});
