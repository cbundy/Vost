import { describe, expect, it } from 'vitest';
import type { Pt } from '../../../lib/drawingGeometry';
import { resolveStyle } from '../../../lib/drawingStyle';
import { abcdPattern } from './abcdPattern';
import { cypherPattern } from './cypherPattern';
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
