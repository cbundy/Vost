import { describe, expect, it } from 'vitest';
import { resolveStyle } from '../../../lib/drawingStyle';
import { arrow } from './arrow';
import { arrowMarkDown, arrowMarkUp } from './arrowMark';
import { arrowMarker } from './arrowMarker';
import { circle } from './circle';
import { CAPTION_TOOLS, TOOLS } from './index';
import type { DrawingTool, ToolView } from './types';

function view(tool: DrawingTool, text = '', style: Record<string, unknown> = {}): ToolView {
  return {
    width: 400,
    height: 300,
    anchors: [],
    text,
    times: [],
    candles: [],
    priceToY: () => null,
    formatPrice: String,
    style: { ...resolveStyle(tool.settings ?? [], undefined, undefined).values, ...style },
    styled: false,
  };
}
const tabsOf = (t: DrawingTool) => new Set((t.settings ?? []).map((f) => f.tab));

describe('registry', () => {
  it('lists the new tools after Rectangle in the Shapes family', () => {
    const shapes = TOOLS.filter((t) => t.group === 'shapes').map((t) => t.id);
    expect(shapes).toEqual(['rectangle', 'circle', 'arrow', 'arrowMarker', 'arrowMarkUp', 'arrowMarkDown']);
    expect([...CAPTION_TOOLS].sort()).toEqual(['arrowMarkDown', 'arrowMarkUp', 'arrowMarker']);
    expect(TOOLS.filter((t) => t.barTime).map((t) => t.id)).toEqual(['arrowMarkUp', 'arrowMarkDown']);
  });
});

describe('circle', () => {
  const pts = [{ x: 100, y: 100 }, { x: 150, y: 100 }];
  it('is hit on its border and, with a fill, inside', () => {
    const v = view(circle);
    expect(circle.hit(pts, { x: 100, y: 52 }, v)).toBe(true);
    expect(circle.hit(pts, { x: 100, y: 100 }, v)).toBe(true);
    expect(circle.hit(pts, { x: 100, y: 30 }, v)).toBe(false);
    const bare = view(circle, '', { fillOpacity: 0 });
    expect(circle.hit(pts, { x: 100, y: 100 }, bare)).toBe(false);
    expect(circle.hit(pts, { x: 100, y: 52 }, bare)).toBe(true);
  });
  it('has handles at the centre and the edge point', () => {
    expect(circle.handles(pts, view(circle))).toEqual(pts);
  });
  it('moves with the centre handle and resizes with the edge handle', () => {
    expect(circle.dragHandle!(pts, 0, { x: 120, y: 130 })).toEqual([{ x: 120, y: 130 }, { x: 170, y: 130 }]);
    expect(circle.dragHandle!(pts, 1, { x: 100, y: 160 })).toEqual([pts[0], { x: 100, y: 160 }]);
  });
  it('has the rectangle border and fill settings and no text', () => {
    expect((circle.settings ?? []).map((f) => f.key)).toEqual(['color', 'width', 'lineStyle', 'fillColor', 'fillOpacity']);
    expect(circle.caption).toBeUndefined();
  });
});

describe('arrow', () => {
  const pts = [{ x: 100, y: 200 }, { x: 200, y: 100 }];
  it('turns the arrow head at the end on', () => {
    const s = view(arrow).style;
    expect([s.arrowStart, s.arrowEnd]).toEqual([false, true]);
  });
  it('is hit on its line only and has handles at both ends', () => {
    expect(arrow.hit(pts, { x: 150, y: 150 }, view(arrow))).toBe(true);
    expect(arrow.hit(pts, { x: 150, y: 170 }, view(arrow))).toBe(false);
    expect(arrow.handles(pts, view(arrow))).toEqual(pts);
  });
  it('shows axis labels while selected', () => {
    const a = [{ time: 1, price: 2 }, { time: 3, price: 4 }];
    expect(arrow.axisLabels!(a, {}, true)).toEqual({ price: [2, 4], time: [1, 3] });
    expect(arrow.axisLabels!(a, {}, false)).toEqual({});
  });
});

describe('arrow marker', () => {
  const pts = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
  it('is hit on the shape and on its label, not a little away', () => {
    expect(arrowMarker.hit(pts, { x: 150, y: 100 }, view(arrowMarker))).toBe(true);
    expect(arrowMarker.hit(pts, { x: 150, y: 120 }, view(arrowMarker))).toBe(false);
    expect(arrowMarker.hit(pts, { x: 60, y: 100 }, view(arrowMarker))).toBe(false);
    expect(arrowMarker.hit(pts, { x: 60, y: 100 }, view(arrowMarker, 'target'))).toBe(true);
  });
  it('has handles at both ends and a Text tab', () => {
    expect(arrowMarker.handles(pts, view(arrowMarker))).toEqual(pts);
    expect(tabsOf(arrowMarker).has('text')).toBe(true);
    expect((arrowMarker.settings ?? []).filter((f) => f.tab === 'text').map((f) => f.key)).toEqual(['textColor', 'textSize', 'bold', 'italic']);
    expect(arrowMarker.caption).toBe(true);
  });
  it('draws nothing and throws nothing for equal anchors', () => {
    const same = [{ x: 5, y: 5 }, { x: 5, y: 5 }];
    expect(arrowMarker.hit(same, { x: 5, y: 5 }, view(arrowMarker, 'x'))).toBe(false);
  });
});

describe('arrow marks', () => {
  const tip = [{ x: 100, y: 100 }];
  it('are one anchor on a bar time with a Text tab', () => {
    for (const t of [arrowMarkUp, arrowMarkDown]) {
      expect(t.anchors).toBe(1);
      expect(t.barTime).toBe(true);
      expect(t.caption).toBe(true);
      expect(tabsOf(t).has('text')).toBe(true);
      expect(t.handles(tip, view(t))).toEqual(tip);
    }
  });
  it('up sits below the point, down above it', () => {
    expect(arrowMarkUp.hit(tip, { x: 100, y: 115 }, view(arrowMarkUp))).toBe(true);
    expect(arrowMarkUp.hit(tip, { x: 100, y: 85 }, view(arrowMarkUp))).toBe(false);
    expect(arrowMarkDown.hit(tip, { x: 100, y: 85 }, view(arrowMarkDown))).toBe(true);
    expect(arrowMarkDown.hit(tip, { x: 100, y: 115 }, view(arrowMarkDown))).toBe(false);
  });
  it('are hit on their label beyond the tail', () => {
    expect(arrowMarkUp.hit(tip, { x: 100, y: 135 }, view(arrowMarkUp))).toBe(false);
    expect(arrowMarkUp.hit(tip, { x: 100, y: 135 }, view(arrowMarkUp, 'buy'))).toBe(true);
    expect(arrowMarkDown.hit(tip, { x: 100, y: 65 }, view(arrowMarkDown, 'sell'))).toBe(true);
  });
});
