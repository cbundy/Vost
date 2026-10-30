import { describe, expect, it } from 'vitest';
import { resolveStyle, validateValue } from '../../../lib/drawingStyle';
import type { Drawing } from '../../../lib/drawings';
import { longPosition } from './longPosition';
import { shortPosition } from './shortPosition';
import { TOOLS } from './index';
import { POSITION_STOP_FRACTION, POSITION_TARGET_FRACTION, POSITION_WIDTH_PX } from './positionTool';
import type { DrawingTool, ToolView } from './types';

const W = 600;
const H = 400;
const fmt = (p: number) => p.toFixed(2);
// A price scale where y = 400 - price.
const y = (p: number) => H - p;
const anchors = (e: number, t: number, s: number) => [{ time: 10, price: e }, { time: 20, price: t }, { time: 20, price: s }];
function view(tool: DrawingTool, a = anchors(200, 250, 180), style?: Record<string, unknown>, extra: Partial<ToolView> = {}): ToolView {
  return { width: W, height: H, anchors: a, candles: [], text: '', times: [], priceToY: y, formatPrice: fmt, style: resolveStyle(tool.settings ?? [], style).values, styled: false, cells: [], glyph: '', ...extra };
}
function recorder() {
  const texts: string[] = [];
  const calls: string[] = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === 'fillText' ? (t: string) => texts.push(t) : k === 'measureText' ? (t: string) => ({ width: t.length * 6 }) : (...a: unknown[]) => calls.push(`${String(k)}${a.length}`)), set: () => true }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, calls };
}
// Pixels of a long: entry (100, 200), target 100 px above... (x0 = 100, x1 = 300).
const longPts = [{ x: 100, y: 200 }, { x: 300, y: 150 }, { x: 300, y: 220 }];
const shortPts = [{ x: 100, y: 200 }, { x: 300, y: 250 }, { x: 300, y: 180 }];

describe.each([
  [longPosition, longPts, 'longPosition', 'Long position'],
  [shortPosition, shortPts, 'shortPosition', 'Short position'],
] as const)('$id', (tool, pts, id, label) => {
  const v = view(tool);
  it('is registered in Forecasting before the measure, with three anchors placed by one click', () => {
    expect([tool.id, tool.label, tool.group, tool.section]).toEqual([id, label, 'forecast-measure', 'Forecasting']);
    expect(tool.anchors).toBe(3);
    expect(tool.placed).toBe(1);
    expect(tool.hoverPreview).toBe(true);
    const ids = TOOLS.map((t) => t.id);
    expect(ids.indexOf(id)).toBeLessThan(ids.indexOf('measure'));
  });
  it('is hit in both zones and on the edges, not a little outside', () => {
    const [e, t, s] = pts;
    expect(tool.hit(pts, { x: 200, y: (e.y + t.y) / 2 }, v, 0)).toBe(true);
    expect(tool.hit(pts, { x: 200, y: (e.y + s.y) / 2 }, v, 0)).toBe(true);
    expect(tool.hit(pts, { x: 100, y: e.y }, v, 0)).toBe(true);
    expect(tool.hit(pts, { x: 300, y: t.y }, v, 0)).toBe(true);
    expect(tool.hit(pts, { x: 200, y: s.y }, v, 0)).toBe(true);
    expect(tool.hit(pts, { x: 200, y: Math.min(t.y, s.y) - 10 }, v, 3)).toBe(false);
    expect(tool.hit(pts, { x: 200, y: Math.max(t.y, s.y) + 10 }, v, 3)).toBe(false);
    expect(tool.hit(pts, { x: 80, y: e.y }, v, 3)).toBe(false);
    expect(tool.hit(pts, { x: 320, y: e.y }, v, 3)).toBe(false);
    expect(tool.hit([pts[0]], { x: 100, y: e.y }, v, 0)).toBe(false);
  });
  it('has four handles: the entry, the target and stop corners and the right edge', () => {
    const [e, t, s] = pts;
    expect(tool.handles(pts, v)).toEqual([e, { x: 100, y: t.y }, { x: 100, y: s.y }, { x: 300, y: e.y }]);
  });
  it('moves the end of both zones together from the right edge handle', () => {
    const [e, t, s] = tool.dragHandle!(pts, 3, { x: 420, y: 10 });
    expect([e, t.x, s.x, t.y, s.y]).toEqual([pts[0], 420, 420, pts[1].y, pts[2].y]);
    const back = tool.dragHandle!(pts, 3, { x: 50, y: 0 });
    expect(back[1].x).toBe(101);
  });
  it('moves the entry in price and time, between the stop and the target', () => {
    const lowHigh = [Math.min(pts[1].y, pts[2].y), Math.max(pts[1].y, pts[2].y)];
    const [e, t, s] = tool.dragHandle!(pts, 0, { x: 60, y: 210 });
    expect([e.x, e.y, t, s]).toEqual([60, 210, pts[1], pts[2]]);
    const beyond = tool.dragHandle!(pts, 0, { x: 100, y: -500 })[0];
    expect(beyond.y).toBe(lowHigh[0] + 1);
    expect(tool.dragHandle!(pts, 0, { x: 100, y: 900 })[0].y).toBe(lowHigh[1] - 1);
  });
  it('keeps the target on its side of the entry and clamps at one tick', () => {
    const f = tool === longPosition ? -1 : 1;
    const dragged = tool.dragHandle!(pts, 1, { x: 100, y: pts[0].y - f * 30 }, { shift: false, view: view(tool, anchors(200, 250, 180)) })[1];
    expect(dragged.y).toBe(pts[0].y + f * 1); // crossed: clamped to one pixel (no tick size)
    const ok = tool.dragHandle!(pts, 1, { x: 100, y: pts[0].y + f * 80 })[1];
    expect(ok).toEqual({ x: 300, y: pts[0].y + f * 80 });
    const stop = tool.dragHandle!(pts, 2, { x: 100, y: pts[0].y + f * 30 })[2];
    expect(stop.y).toBe(pts[0].y - f * 1);
  });
  it('clamps at the series tick when the view has one', () => {
    const f = tool === longPosition ? -1 : 1;
    const withTick = view(tool, anchors(200, 250, 180), undefined, { tickSize: 5 });
    const dragged = tool.dragHandle!(pts, 1, { x: 100, y: pts[0].y - f * 40 }, { shift: false, view: withTick })[1];
    expect(Math.abs(dragged.y - pts[0].y)).toBe(5);
    expect(Math.sign(dragged.y - pts[0].y)).toBe(f);
  });
  it('settles one point into three on the right sides, to the right', () => {
    const [e, t, s] = tool.settle!([{ x: 120, y: 200 }], view(tool));
    const f = tool === longPosition ? -1 : 1;
    expect(e).toEqual({ x: 120, y: 200 });
    expect(t).toEqual({ x: 120 + POSITION_WIDTH_PX, y: 200 + f * H * POSITION_TARGET_FRACTION });
    expect(s).toEqual({ x: 120 + POSITION_WIDTH_PX, y: 200 - f * H * POSITION_STOP_FRACTION });
    expect(tool.settle!(pts)).toEqual(pts);
  });
  it('draws the shape the click would place from one point and never throws on none', () => {
    const r = recorder();
    expect(() => tool.draw(r.ctx, [{ x: 100, y: 200 }], view(tool, [{ time: 1, price: 200 }]), { selected: false })).not.toThrow();
    expect(r.calls.filter((c) => c.startsWith('fillRect')).length).toBe(2);
    expect(() => tool.draw(recorder().ctx, [], view(tool, []), { selected: false })).not.toThrow();
  });
  it('draws with one bar and with none', () => {
    const one = [{ time: 12, open: 1, high: 2, low: 0, close: 1 }];
    for (const candles of [[], one]) expect(() => tool.draw(recorder().ctx, pts, view(tool, anchors(200, 250, 180), undefined, { candles, times: candles.map((c) => c.time) }), { selected: true })).not.toThrow();
  });
  it('labels the axes with the three prices and two times only while selected', () => {
    const a = anchors(200, 250, 180);
    expect(tool.axisLabels!(a, {}, false)).toEqual({});
    expect(tool.axisLabels!(a, {}, true)).toEqual({ price: [200, 250, 180], time: [10, 20] });
  });
  it('shows the quantity and the open state when selected, the stats on the zones and nothing when idle', () => {
    const long = tool === longPosition;
    const a = long ? anchors(200, 250, 180) : anchors(200, 150, 220);
    const r = recorder();
    tool.draw(r.ctx, pts, view(tool, a), { selected: true });
    // risk 250 / 20 = 12
    expect(r.texts).toContain('Open');
    expect(r.texts).toContain('Qty: 12');
    expect(r.texts.some((t) => t.startsWith('Target:'))).toBe(false); // the zone is too narrow for its line
    const wide = recorder();
    tool.draw(wide.ctx, pts.map((p, i) => (i === 0 ? p : { ...p, x: 600 })), view(tool, a), { selected: true });
    expect(wide.texts.some((t) => t.startsWith('Target: 50.00 (25.00%)'))).toBe(true);
    expect(wide.texts.some((t) => t.startsWith('Stop: 20.00 (10.00%)'))).toBe(true);
    const idle = recorder();
    tool.draw(idle.ctx, pts, view(tool, a), { selected: false });
    expect(idle.texts).not.toContain('Qty: 12');
    const always = recorder();
    tool.draw(always.ctx, pts, view(tool, a, { alwaysStats: true }), { selected: false });
    expect(always.texts).toContain('Qty: 12');
  });
  it('reports the closed profit of the bar that reaches the target, and the loss when the stop is hit first', () => {
    const long = tool === longPosition;
    const a = long ? anchors(200, 250, 180) : anchors(200, 150, 220);
    const reach = { time: 15, open: 200, high: long ? 260 : 205, low: long ? 195 : 140, close: 200 };
    const times = [10, 15, 20];
    const hit = recorder();
    tool.draw(hit.ctx, pts, view(tool, a, undefined, { candles: [reach], times }), { selected: true });
    expect(hit.texts).toContain('Closed P&L: +600.00'); // 12 x 50
    const stopBar = { time: 15, open: 200, high: long ? 205 : 230, low: long ? 170 : 195, close: 200 };
    const lost = recorder();
    tool.draw(lost.ctx, pts, view(tool, a, undefined, { candles: [stopBar], times }), { selected: true });
    expect(lost.texts).toContain('Closed P&L: -240.00'); // 12 x 20
  });
  it('uses the compact label and honours the risk inputs', () => {
    const a = tool === longPosition ? anchors(200, 250, 180) : anchors(200, 150, 220);
    const r = recorder();
    tool.draw(r.ctx, pts, view(tool, a, { compact: true, riskUnit: 'amount', risk: 100 }), { selected: true });
    expect(r.texts).toContain('Open, Qty: 5, R/R: 2.5');
    expect(r.texts.some((t) => t.startsWith('Target:'))).toBe(false);
  });
  it('keeps a drawing whose end times differ by giving both the target time, and drops wrong sides or bad values', () => {
    const long = tool === longPosition;
    const good = long ? anchors(200, 250, 180) : anchors(200, 150, 220);
    const d = (an: Drawing['anchors']): Drawing => ({ id: 'x', tool: id, anchors: an });
    expect(tool.validate!(d(good))).toEqual(d(good));
    const split = [good[0], good[1], { ...good[2], time: 99 }];
    expect(tool.validate!(d(split))!.anchors[2].time).toBe(good[1].time);
    const wrong = long ? anchors(200, 150, 220) : anchors(200, 250, 180);
    expect(tool.validate!(d(wrong))).toBeNull();
    expect(tool.validate!(d([good[0], { ...good[1], price: NaN }, good[2]]))).toBeNull();
    expect(tool.validate!(d([{ time: Infinity, price: 1 }, good[1], good[2]]))).toBeNull();
  });
  it('moves both end times when the Coordinates tab edits one, and refuses a wrong side', () => {
    const good = tool === longPosition ? anchors(200, 250, 180) : anchors(200, 150, 220);
    const next = good.map((a, i) => (i === 2 ? { ...a, time: 33 } : a));
    expect(tool.editAnchor!(good, next, 2).map((a) => a.time)).toEqual([10, 33, 33]);
    const bad = good.map((a, i) => (i === 1 ? { ...a, price: tool === longPosition ? 150 : 250 } : a));
    expect(tool.editAnchor!(good, bad, 1)).toBe(good);
  });
});

describe('the Inputs settings', () => {
  const fieldOf = (key: string) => longPosition.settings!.find((f) => f.key === key)!;
  it('has the four inputs on the Inputs tab with their defaults', () => {
    const inputs = longPosition.settings!.filter((f) => f.tab === 'inputs');
    expect(inputs.map((f) => [f.key, f.default])).toEqual([['accountSize', 1000], ['lotSize', 1], ['risk', 25], ['riskUnit', 'percent']]);
    expect(longPosition.settings).toEqual(shortPosition.settings);
  });
  it('validates account size and lot size as positive, risk unit as one of its options', () => {
    expect(validateValue(fieldOf('accountSize'), 0)).toBeUndefined();
    expect(validateValue(fieldOf('accountSize'), -5)).toBeUndefined();
    expect(validateValue(fieldOf('accountSize'), 5000)).toBe(5000);
    expect(validateValue(fieldOf('lotSize'), 0)).toBeUndefined();
    expect(validateValue(fieldOf('lotSize'), 0.1)).toBe(0.1);
    expect(validateValue(fieldOf('riskUnit'), 'amount')).toBe('amount');
    expect(validateValue(fieldOf('riskUnit'), 'lots')).toBeUndefined();
  });
});
