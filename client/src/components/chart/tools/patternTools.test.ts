import { describe, expect, it } from 'vitest';
import type { Pt } from '../../../lib/drawingGeometry';
import { resolveStyle } from '../../../lib/drawingStyle';
import { abcdPattern } from './abcdPattern';
import { cypherPattern } from './cypherPattern';
import { headAndShoulders } from './headAndShoulders';
import { threeDrives } from './threeDrives';
import { trianglePattern } from './trianglePattern';
import type { DrawingTool, ToolView } from './types';
import { xabcdPattern } from './xabcdPattern';

const W = 400;
const H = 300;

function view(tool: DrawingTool, anchors: ToolView['anchors'] = [], style?: Record<string, unknown>): ToolView {
  return {
    width: W,
    height: H,
    anchors,
    text: '',
    times: [],
    candles: [],
    priceToY: (p) => H - p,
    formatPrice: String,
    style: resolveStyle(tool.settings ?? [], style, undefined).values,
    styled: false,
    glyph: '',
    cells: [],
  };
}

/** A canvas context that records the calls made on it, texts included. */
function stubCtx(): { ctx: CanvasRenderingContext2D; calls: string[]; texts: string[] } {
  const calls: string[] = [];
  const texts: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => {
      if (k in t) return t[k];
      if (k === 'fillText') return (s: string) => void texts.push(s);
      return (...a: unknown[]) => void calls.push(`${k}(${a.map((x) => (typeof x === 'number' ? Math.round(x) : '')).join(',')})`);
    },
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, texts };
}

const PX: Pt[] = [{ x: 20, y: 250 }, { x: 80, y: 50 }, { x: 140, y: 180 }, { x: 200, y: 90 }, { x: 260, y: 200 }];
const ANCHORS = [100, 200, 138, 176, 121].map((price, i) => ({ time: (i + 1) * 60, price }));
const tools = [xabcdPattern, cypherPattern, abcdPattern];
const counts = [5, 5, 4];

/** Head and shoulders pixels: left shoulder 80,120, head 200,60, right shoulder 320,120, neckline y 180. */
const HS: Pt[] = [{ x: 10, y: 250 }, { x: 80, y: 120 }, { x: 140, y: 180 }, { x: 200, y: 60 }, { x: 260, y: 180 }, { x: 320, y: 120 }, { x: 390, y: 250 }];
const HS_ANCHORS = [100, 150, 120, 180, 120, 150, 100].map((price, i) => ({ time: (i + 1) * 60, price }));
const TRI: Pt[] = [{ x: 20, y: 40 }, { x: 40, y: 250 }, { x: 150, y: 90 }, { x: 160, y: 200 }];
const TRI_ANCHORS = [200, 100, 170, 130].map((price, i) => ({ time: (i + 1) * 60, price }));
const TD: Pt[] = [{ x: 20, y: 280 }, { x: 70, y: 180 }, { x: 110, y: 230 }, { x: 170, y: 120 }, { x: 210, y: 180 }, { x: 280, y: 60 }, { x: 330, y: 100 }];
const TD_ANCHORS = [100, 200, 138.2, 216.8, 168.2, 230, 200].map((price, i) => ({ time: (i + 1) * 60, price }));

describe('the pattern tools', () => {
  it('sit in the Patterns family, section Chart patterns, with 5, 5 and 4 anchors', () => {
    expect(tools.map((t) => [t.id, t.group, t.section, t.anchors])).toEqual([
      ['xabcdPattern', 'patterns', 'Chart patterns', 5],
      ['cypherPattern', 'patterns', 'Chart patterns', 5],
      ['abcdPattern', 'patterns', 'Chart patterns', 4],
    ]);
  });
  it('fill only XABCD and Cypher', () => {
    expect(tools.map((t) => t.settings!.some((f) => f.key === 'fillColor'))).toEqual([true, true, false]);
    for (const t of tools) expect(view(t).style.showRatios).toBe(true);
  });

  tools.forEach((tool, k) => {
    const pts = PX.slice(0, counts[k]);
    describe(tool.id, () => {
      it('hits on a leg midpoint and inside a filled triangle, not 10 px off a leg', () => {
        const v = view(tool, ANCHORS);
        expect(tool.hit(pts, { x: 50, y: 150 }, v)).toBe(true);
        expect(tool.hit(pts, { x: 30, y: 150 }, v)).toBe(false);
        if (tool.settings!.some((f) => f.key === 'fillColor')) expect(tool.hit(pts, { x: 80, y: 160 }, v)).toBe(true);
      });
      it('has one handle per point and no custom drag', () => {
        expect(tool.handles(pts, view(tool))).toEqual(pts);
        expect(tool.dragHandle).toBeUndefined();
      });
      it('draws partial drafts and flat legs without throwing or writing Infinity or NaN', () => {
        for (let n = 0; n <= pts.length; n++) {
          for (const anchors of [ANCHORS.slice(0, n), ANCHORS.slice(0, n).map((a) => ({ ...a, price: 5 }))]) {
            const { ctx, texts, calls } = stubCtx();
            expect(() => tool.draw(ctx, pts.slice(0, n), view(tool, anchors), { selected: n % 2 === 0 })).not.toThrow();
            expect(texts.join(' ')).not.toMatch(/Infinity|NaN/);
            expect(calls.join(' ')).not.toMatch(/NaN/);
          }
        }
      });
      it('draws the letters, and the ratios only when asked', () => {
        const full = stubCtx();
        tool.draw(full.ctx, pts, view(tool, ANCHORS), { selected: false });
        expect(full.texts.filter((s) => /^[A-Z]$/.test(s))).toEqual(counts[k] === 5 ? ['X', 'A', 'B', 'C', 'D'] : ['A', 'B', 'C', 'D']);
        expect(full.texts.some((s) => /^\d+\.\d{3}$/.test(s))).toBe(true);
        const off = stubCtx();
        tool.draw(off.ctx, pts, view(tool, ANCHORS, { showRatios: false }), { selected: false });
        expect(off.texts.some((s) => /^\d+\.\d{3}$/.test(s))).toBe(false);
      });
      it('shows only the ratios whose legs exist in a partial draft', () => {
        const { ctx, texts } = stubCtx();
        tool.draw(ctx, pts.slice(0, 2), view(tool, ANCHORS.slice(0, 2)), { selected: false });
        expect(texts.some((s) => /^\d+\.\d{3}$/.test(s))).toBe(false);
      });
      it('lists every point price and time when selected, nothing otherwise', () => {
        const a = ANCHORS.slice(0, counts[k]);
        expect(tool.axisLabels!(a, {}, false)).toEqual({});
        expect(tool.axisLabels!(a, {}, true)).toEqual({ price: a.map((x) => x.price), time: a.map((x) => x.time) });
      });
    });
  });
});

const NEW = [
  { tool: headAndShoulders, pts: HS, anchors: HS_ANCHORS, hitOn: { x: 50, y: 185 }, neck: { x: 100, y: 180 }, fill: { x: 200, y: 120 }, texts: ['Left Shoulder', 'Head', 'Right Shoulder'], fillable: true, ratios: false },
  { tool: trianglePattern, pts: TRI, anchors: TRI_ANCHORS, hitOn: { x: 30, y: 145 }, neck: { x: 85, y: 65 }, fill: { x: 100, y: 120 }, texts: ['A', 'B', 'C', 'D'], fillable: true, ratios: false },
  { tool: threeDrives, pts: TD, anchors: TD_ANCHORS, hitOn: { x: 45, y: 230 }, neck: { x: 45, y: 230 }, fill: null, texts: ['1', 'A', '2', 'C', '3'], fillable: false, ratios: true },
];

describe('Head and shoulders, Triangle pattern and Three drives', () => {
  it('sit in the Patterns family, section Chart patterns, with 7, 4 and 7 anchors', () => {
    expect(NEW.map((n) => [n.tool.id, n.tool.group, n.tool.section, n.tool.anchors])).toEqual([
      ['headAndShoulders', 'patterns', 'Chart patterns', 7],
      ['trianglePattern', 'patterns', 'Chart patterns', 4],
      ['threeDrives', 'patterns', 'Chart patterns', 7],
    ]);
  });
  it('offer fills, Background and Show ratios as the pattern needs', () => {
    const keys = (t: DrawingTool) => t.settings!.map((f) => f.key);
    expect(NEW.map((n) => keys(n.tool).includes('fillColor'))).toEqual([true, true, false]);
    expect(NEW.map((n) => keys(n.tool).includes('background'))).toEqual([false, true, false]);
    expect(NEW.map((n) => keys(n.tool).includes('showRatios'))).toEqual([false, false, true]);
    expect(NEW.map((n) => n.tool.settings!.find((f) => f.key === 'showRatios')?.tab)).toEqual([undefined, undefined, 'text']);
  });

  for (const n of NEW) {
    const { tool, pts } = n;
    describe(tool.id, () => {
      const v = view(tool, n.anchors);
      it('hits on a leg, on its extra line and inside a fill, not 10 px off', () => {
        const leg = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        expect(tool.hit(pts, leg, v)).toBe(true);
        expect(tool.hit(pts, { x: leg.x - 10, y: leg.y - 10 }, v)).toBe(false);
        expect(tool.hit(pts, n.neck, v)).toBe(true);
        if (n.fill) expect(tool.hit(pts, n.fill, v)).toBe(true);
        expect(tool.hit(pts, { x: 200, y: 299 }, v)).toBe(false);
      });
      it('has one handle per point and no custom drag', () => {
        expect(tool.handles(pts, v)).toEqual(pts);
        expect(tool.dragHandle).toBeUndefined();
      });
      it('draws partial drafts, flat prices and equal points without throwing or NaN', () => {
        for (let k = 0; k <= pts.length; k++) {
          for (const [px, anchors] of [
            [pts.slice(0, k), n.anchors.slice(0, k)],
            [pts.slice(0, k), n.anchors.slice(0, k).map((a) => ({ ...a, price: 5 }))],
            [pts.slice(0, k).map(() => pts[0]), n.anchors.slice(0, k)],
          ] as const) {
            const { ctx, texts, calls } = stubCtx();
            expect(() => tool.draw(ctx, [...px], view(tool, anchors), { selected: k % 2 === 0 })).not.toThrow();
            expect(tool.hit([...px], { x: 5, y: 5 }, view(tool, anchors))).toBeTypeOf('boolean');
            expect(texts.join(' ')).not.toMatch(/Infinity|NaN/);
            expect(calls.join(' ')).not.toMatch(/NaN|Infinity/);
          }
        }
      });
      it('draws exactly its labels, and the four ratios only for Three drives and when asked', () => {
        const full = stubCtx();
        tool.draw(full.ctx, pts, v, { selected: false });
        expect(full.texts.filter((s) => !/^\d+\.\d{3}$/.test(s) || n.texts.includes(s))).toEqual(n.texts);
        expect(full.texts.filter((s) => /^\d+\.\d{3}$/.test(s))).toEqual(n.ratios ? ['0.618', '1.272', '0.618', '1.272'] : []);
        if (n.ratios) {
          const off = stubCtx();
          tool.draw(off.ctx, pts, view(tool, n.anchors, { showRatios: false }), { selected: false });
          expect(off.texts).toEqual(n.texts);
        }
      });
      it('lists every point price and time when selected, nothing otherwise', () => {
        expect(tool.axisLabels!(n.anchors, {}, false)).toEqual({});
        expect(tool.axisLabels!(n.anchors, {}, true)).toEqual({ price: n.anchors.map((x) => x.price), time: n.anchors.map((x) => x.time) });
      });
    });
  }

  it('the Triangle pattern fill follows the Background setting', () => {
    const on = stubCtx();
    trianglePattern.draw(on.ctx, TRI, view(trianglePattern, TRI_ANCHORS), { selected: false });
    const off = stubCtx();
    trianglePattern.draw(off.ctx, TRI, view(trianglePattern, TRI_ANCHORS, { background: false }), { selected: false });
    expect(on.calls.filter((c) => c.startsWith('fill(')).length).toBe(1);
    expect(off.calls.filter((c) => c.startsWith('fill(')).length).toBe(0);
  });
  it('the Triangle pattern only hits inside its fill while Background is on', () => {
    const inside = { x: 100, y: 120 };
    expect(trianglePattern.hit(TRI, inside, view(trianglePattern, TRI_ANCHORS))).toBe(true);
    expect(trianglePattern.hit(TRI, inside, view(trianglePattern, TRI_ANCHORS, { background: false }))).toBe(false);
  });
  it('Head and shoulders fills the two shoulders and the head once their points exist', () => {
    const fills = (k: number) => {
      const s = stubCtx();
      headAndShoulders.draw(s.ctx, HS.slice(0, k), view(headAndShoulders, HS_ANCHORS.slice(0, k)), { selected: false });
      return s.calls.filter((c) => c.startsWith('fill(')).length;
    };
    expect([3, 4, 5, 6, 7].map(fills)).toEqual([0, 0, 2, 2, 3]);
  });
});
