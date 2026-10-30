import { describe, expect, it } from 'vitest';
import type { OhlcBar, Pt } from '../../../lib/drawingGeometry';
import { resolveStyle } from '../../../lib/drawingStyle';
import { anchoredVolumeProfile } from './anchoredVolumeProfile';
import { anchoredVwap } from './anchoredVwap';
import { fixedRangeVolumeProfile } from './fixedRangeVolumeProfile';
import { getTool } from './index';
import type { DrawingTool, ToolView } from './types';

const W = 600;
const H = 400;
// Ten bars a minute apart, 20 px each from x = 100; price p sits at y = 400 - 10p.
const BARS: OhlcBar[] = Array.from({ length: 10 }, (_, i) => ({ time: 60 * (i + 1), open: 10 + i, high: 14 + i, low: 8 + i, close: 12 + i, volume: 10 + i }));
const xOf = (t: number) => 100 + ((t - 60) / 60) * 20;
const yOf = (p: number) => H - p * 10;

function view(tool: DrawingTool, anchors: { time: number; price: number }[], over: Record<string, unknown> = {}, candles: OhlcBar[] = BARS): ToolView {
  return {
    width: W,
    height: H,
    anchors,
    text: '',
    cells: [],
    glyph: '',
    times: candles.map((c) => c.time),
    candles,
    indexToX: (i) => 100 + 20 * i,
    priceToY: yOf,
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
const ptsOf = (anchors: readonly { time: number; price: number }[]): Pt[] => anchors.map((a) => ({ x: xOf(a.time), y: yOf(a.price) }));
const draws = (tool: DrawingTool, v: ToolView) => () => tool.draw(stub(), ptsOf(v.anchors), v, { selected: true });

const A1 = [{ time: 180, price: 15 }];
const A2 = [{ time: 120, price: 15 }, { time: 480, price: 15 }];

describe('the volume-based tools', () => {
  it('sit in the Forecasting and measurers family, section Volume-based, before the Measure', () => {
    const tools = [anchoredVwap, fixedRangeVolumeProfile, anchoredVolumeProfile];
    expect(tools.map((t) => [t.id, t.group, t.section, t.anchors, t.barTime, t.timeOnly])).toEqual([
      ['anchoredVwap', 'forecast-measure', 'Volume-based', 1, true, true],
      ['fixedRangeVolumeProfile', 'forecast-measure', 'Volume-based', 2, true, true],
      ['anchoredVolumeProfile', 'forecast-measure', 'Volume-based', 1, true, true],
    ]);
    const idx = (id: string) => ['anchoredVwap', 'fixedRangeVolumeProfile', 'anchoredVolumeProfile', 'measure'].indexOf(getTool(id)?.id ?? '');
    expect([idx('anchoredVwap'), idx('measure')]).toEqual([0, 3]);
  });

  it('default to the settings of TradingView: hlc3, 24 rows, 70 percent', () => {
    expect(view(anchoredVwap, A1).style).toMatchObject({ source: 'hlc3', showBand1: true, showBand2: false, mult1: 1, mult2: 2, mult3: 3 });
    expect(view(fixedRangeVolumeProfile, A2).style).toMatchObject({ rowsLayout: 'rows', rowSize: 24, valueAreaVolume: 70, volumeMode: 'updown', showPoc: true });
    expect(view(anchoredVolumeProfile, A1).style).toMatchObject({ rowSize: 24, valueAreaVolume: 70 });
  });

  for (const [tool, anchors] of [[anchoredVwap, A1], [fixedRangeVolumeProfile, A2], [anchoredVolumeProfile, A1]] as const) {
    describe(tool.id, () => {
      it('keeps the price when a handle is dragged', () => {
        const pts = ptsOf(anchors);
        const out = tool.dragHandle!(pts, 0, { x: 300, y: 5 });
        expect(out[0]).toEqual({ x: 300, y: pts[0].y });
        expect(out.slice(1)).toEqual(pts.slice(1));
      });

      it('draws nothing and never throws with no bars, one bar, an off-scale price or an anchor outside the bars', () => {
        const cases: ToolView[] = [
          view(tool, anchors, {}, []),
          view(tool, anchors, {}, BARS.slice(0, 1)),
          { ...view(tool, anchors), priceToY: () => null },
          { ...view(tool, anchors), indexToX: undefined },
          view(tool, anchors.map((a) => ({ ...a, time: 99999 }))),
          view(tool, anchors.map((a) => ({ ...a, time: 1 }))),
          view(tool, anchors, {}, BARS.map((b) => ({ ...b, volume: 0 }))),
          view(tool, anchors, {}, BARS.map((b) => ({ ...b, volume: undefined }))),
        ];
        for (const v of cases) {
          expect(draws(tool, v)).not.toThrow();
          expect(() => tool.hit(ptsOf(v.anchors), { x: 150, y: 200 }, v)).not.toThrow();
          expect(() => tool.handles(ptsOf(v.anchors), v)).not.toThrow();
          expect(() => tool.axisLabels?.(v.anchors, v.style, true, v.times, v.candles)).not.toThrow();
        }
        const none = view(tool, anchors.map((a) => ({ ...a, time: 99999 })));
        expect(tool.hit(ptsOf(none.anchors), { x: 150, y: 200 }, none)).toBe(false);
      });

      it('labels the anchor times when selected and nothing otherwise', () => {
        const v = view(tool, anchors);
        expect(tool.axisLabels!(anchors, v.style, true, v.times, v.candles).time).toEqual(anchors.map((a) => a.time));
        expect(tool.axisLabels!(anchors, v.style, false, v.times, v.candles)).toEqual({});
      });
    });
  }
});

describe('anchoredVwap', () => {
  const v = (over: Record<string, unknown> = {}) => view(anchoredVwap, A1, over);
  // From the bar at 180 the first VWAP is that bar's hlc3: (16 + 10 + 14) / 3 = 13.33 -> y = 400 - 133.3.
  const first = { x: xOf(180), y: yOf((16 + 10 + 14) / 3) };

  it('puts its handle on the VWAP line at the anchor bar', () => {
    const h = anchoredVwap.handles(ptsOf(A1), v());
    expect(h).toHaveLength(1);
    expect(h[0].x).toBeCloseTo(first.x);
    expect(h[0].y).toBeCloseTo(first.y);
  });

  it('hits on the VWAP line and a band and not 10 px away or in the empty area between unfilled bands', () => {
    const view1 = v({ showBand1: true, fillBand1: false, mult1: 5 });
    const pts = ptsOf(A1);
    expect(anchoredVwap.hit(pts, { x: first.x, y: first.y + 1 }, view1)).toBe(true);
    expect(anchoredVwap.hit(pts, { x: first.x, y: first.y + 10 }, view1)).toBe(false);
    expect(anchoredVwap.hit(pts, { x: first.x - 30, y: first.y }, view1)).toBe(false);
    // At the bar at 300 (index 4) the band is five sigma above the VWAP, worked from the bars by hand.
    const used = BARS.slice(2, 5);
    const src = (b: OhlcBar) => (b.high + b.low + b.close) / 3;
    const vol = used.reduce((t, b) => t + b.volume!, 0);
    const mean = used.reduce((t, b) => t + src(b) * b.volume!, 0) / vol;
    const sigma = Math.sqrt(used.reduce((t, b) => t + src(b) ** 2 * b.volume!, 0) / vol - mean * mean);
    const x = xOf(300);
    expect(sigma).toBeGreaterThan(0.5);
    const band = 5 * sigma;
    expect(anchoredVwap.hit(pts, { x, y: yOf(mean + band) }, view1)).toBe(true);
    expect(anchoredVwap.hit(pts, { x, y: yOf(mean - band) }, view1)).toBe(true);
    expect(anchoredVwap.hit(pts, { x, y: yOf(mean + band / 2) }, view1)).toBe(false);
    expect(anchoredVwap.hit(pts, { x, y: yOf(mean + band) - 10 }, view1)).toBe(false);
  });

  it('hits in the space between a filled band and the VWAP', () => {
    const pts = ptsOf(A1);
    const open = v({ showBand1: true, fillBand1: false });
    const filled = v({ showBand1: true, fillBand1: true, mult1: 5 });
    const x = xOf(300);
    // Find a y between the VWAP and the 5-sigma band at x.
    const y = [...Array(400).keys()].find((yy) => !anchoredVwap.hit(pts, { x, y: yy }, open) && anchoredVwap.hit(pts, { x, y: yy }, filled));
    expect(y).toBeDefined();
  });

  it('labels the last VWAP on the price axis while selected', () => {
    const l = anchoredVwap.axisLabels!(A1, view(anchoredVwap, A1).style, true, [], BARS);
    expect(l.price).toHaveLength(1);
    const num = BARS.slice(2).reduce((s, b) => s + ((b.high + b.low + b.close) / 3) * b.volume!, 0);
    const den = BARS.slice(2).reduce((s, b) => s + b.volume!, 0);
    expect(l.price![0]).toBeCloseTo(num / den);
  });

  it('strokes one point per bar from the anchor bar to the last bar', () => {
    const lineTos: number[] = [];
    const ctx = stub();
    (ctx as unknown as { lineTo: (a: number) => void }).lineTo = (x) => void lineTos.push(x);
    anchoredVwap.draw(ctx, ptsOf(A1), v({ showBand1: false }), { selected: false });
    // One lineTo per bar after the first, from the anchor bar to the last.
    expect(lineTos).toHaveLength(BARS.length - 2 - 1);
  });
});

describe('the volume profiles', () => {
  const fixed = () => view(fixedRangeVolumeProfile, A2);
  const x0 = xOf(120);

  it('have handles at the ends of the range, halfway up it', () => {
    const h = fixedRangeVolumeProfile.handles(ptsOf(A2), fixed());
    expect(h.map((p) => p.x)).toEqual([x0, xOf(480)]);
    // Bars 120..480 span prices 9 to 21.
    expect(h[0].y).toBeCloseTo(yOf(15));
    expect(anchoredVolumeProfile.handles(ptsOf(A1), view(anchoredVolumeProfile, A1))[0].x).toBe(xOf(180));
  });

  it('hit on a row, the point of control and the outline and not a little away from the range', () => {
    const v = fixed();
    const pts = ptsOf(A2);
    const x1 = xOf(480);
    const hit = (p: Pt) => fixedRangeVolumeProfile.hit(pts, p, v);
    // Bars 120..480 span prices 9 to 21: the outline's top edge, and 10 px above it.
    expect(hit({ x: x0 + 50, y: yOf(21) })).toBe(true);
    expect(hit({ x: x0 + 50, y: yOf(21) - 10 })).toBe(false);
    expect(hit({ x: x0 - 20, y: yOf(15) })).toBe(false);
    // A row: the bars start at the left edge.
    expect(hit({ x: x0 + 2, y: yOf(15) })).toBe(true);
    // The point of control line runs across the whole range.
    const poc = yOf(fixedRangeVolumeProfile.axisLabels!(A2, v.style, true, [], BARS).price![0]);
    expect(hit({ x: x1 - 5, y: poc })).toBe(true);
    // Away from every row, line and edge the range is empty.
    const lines = [poc, yOf(21), yOf(9)];
    const gap = [...Array(H).keys()].find((y) => y > yOf(21) + 8 && y < yOf(9) - 8 && lines.every((l) => Math.abs(l - y) > 8) && !hit({ x: x1 - 20, y }));
    expect(gap).toBeDefined();
    expect(hit({ x: x1 - 20, y: gap! })).toBe(false);
  });

  it('puts the histogram on the right when asked and labels the point of control price', () => {
    const v = view(fixedRangeVolumeProfile, A2, { placement: 'right' });
    const pts = ptsOf(A2);
    const x1 = xOf(480);
    expect(fixedRangeVolumeProfile.hit(pts, { x: x1 - 2, y: yOf(14) }, v)).toBe(true);
    const labels = fixedRangeVolumeProfile.axisLabels!(A2, v.style, true, [], BARS);
    expect(labels.price).toHaveLength(1);
    expect(labels.price![0]).toBeGreaterThan(9);
    expect(labels.price![0]).toBeLessThan(19);
    expect(fixedRangeVolumeProfile.axisLabels!(A2, v.style, false, [], BARS)).toEqual({});
  });

  it('anchored: grows to the last bar as bars arrive', () => {
    const v1 = view(anchoredVolumeProfile, A1);
    const more: OhlcBar[] = [...BARS, { time: 660, open: 20, high: 30, low: 19, close: 25, volume: 500 }];
    const v2 = view(anchoredVolumeProfile, A1, {}, more);
    const top1 = anchoredVolumeProfile.axisLabels!(A1, v1.style, true, [], BARS).price![0];
    const top2 = anchoredVolumeProfile.axisLabels!(A1, v2.style, true, [], more).price![0];
    expect(top2).not.toBe(top1);
    expect(anchoredVolumeProfile.hit(ptsOf(A1), { x: xOf(180) + 100, y: yOf(30) }, v2)).toBe(true);
    expect(anchoredVolumeProfile.hit(ptsOf(A1), { x: xOf(180) + 100, y: yOf(30) }, v1)).toBe(false);
  });
});
