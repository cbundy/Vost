import { describe, expect, it } from 'vitest';
import type { Pt } from '../../../lib/drawingGeometry';
import { resolveStyle } from '../../../lib/drawingStyle';
import { ELLIOTT_DEFAULT_DEGREE } from '../../../lib/geometry/elliott';
import { elliottCorrection } from './elliottCorrection';
import { elliottDoubleCombo } from './elliottDoubleCombo';
import { elliottImpulse } from './elliottImpulse';
import { elliottTriangle } from './elliottTriangle';
import { elliottTripleCombo } from './elliottTripleCombo';
import type { DrawingTool, ToolView } from './types';

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

/** A zigzag of up to six points; the first n are used. */
const ALL: Pt[] = [{ x: 20, y: 250 }, { x: 80, y: 120 }, { x: 140, y: 190 }, { x: 220, y: 60 }, { x: 280, y: 130 }, { x: 350, y: 40 }];
const ANCHORS = [50, 180, 110, 240, 170, 260].map((price, i) => ({ time: (i + 1) * 60, price }));

const CASES = [
  { tool: elliottImpulse, n: 6, texts: ['(1)', '(2)', '(3)', '(4)', '(5)'], minor: ['1', '2', '3', '4', '5'] },
  { tool: elliottCorrection, n: 4, texts: ['(A)', '(B)', '(C)'], minor: ['A', 'B', 'C'] },
  { tool: elliottTriangle, n: 6, texts: ['(A)', '(B)', '(C)', '(D)', '(E)'], minor: ['A', 'B', 'C', 'D', 'E'] },
  { tool: elliottDoubleCombo, n: 4, texts: ['(W)', '(X)', '(Y)'], minor: ['W', 'X', 'Y'] },
  { tool: elliottTripleCombo, n: 6, texts: ['(W)', '(X)', '(Y)', '(X)', '(Z)'], minor: ['W', 'X', 'Y', 'X', 'Z'] },
];

describe('the Elliott wave tools', () => {
  it('sit in the Patterns family, section Elliott waves, with 6, 4, 6, 4 and 6 anchors', () => {
    expect(CASES.map((c) => [c.tool.id, c.tool.group, c.tool.section, c.tool.anchors])).toEqual([
      ['elliottImpulse', 'patterns', 'Elliott waves', 6],
      ['elliottCorrection', 'patterns', 'Elliott waves', 4],
      ['elliottTriangle', 'patterns', 'Elliott waves', 6],
      ['elliottDoubleCombo', 'patterns', 'Elliott waves', 4],
      ['elliottTripleCombo', 'patterns', 'Elliott waves', 6],
    ]);
  });

  for (const c of CASES) {
    const { tool } = c;
    const pts = ALL.slice(0, c.n);
    const anchors = ANCHORS.slice(0, c.n);
    describe(tool.id, () => {
      it('has a Wave degree choice defaulting to the default degree; an unknown stored degree falls back', () => {
        const f = tool.settings!.find((s) => s.key === 'degree')!;
        expect(f.kind).toBe('choice');
        expect(f.default).toBe(ELLIOTT_DEFAULT_DEGREE);
        expect(view(tool, anchors, { degree: 'bogus' }).style.degree).toBe(ELLIOTT_DEFAULT_DEGREE);
      });
      it('hits on a wave line, not 10 px off it', () => {
        const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
        expect(tool.hit(pts, mid, view(tool, anchors))).toBe(true);
        expect(tool.hit(pts, { x: mid.x - 10, y: mid.y - 10 }, view(tool, anchors))).toBe(false);
        expect(tool.hit(pts, { x: 200, y: 299 }, view(tool, anchors))).toBe(false);
      });
      it('has one handle per point and no custom drag', () => {
        expect(tool.handles(pts, view(tool))).toEqual(pts);
        expect(tool.dragHandle).toBeUndefined();
      });
      it('draws partial drafts without throwing or writing NaN', () => {
        for (let k = 0; k <= c.n; k++) {
          const { ctx, texts, calls } = stubCtx();
          expect(() => tool.draw(ctx, pts.slice(0, k), view(tool, anchors.slice(0, k)), { selected: k % 2 === 0 })).not.toThrow();
          expect(tool.hit(pts.slice(0, k), { x: 5, y: 5 }, view(tool, anchors.slice(0, k)))).toBeTypeOf('boolean');
          expect(texts.join(' ')).not.toMatch(/NaN|Infinity/);
          expect(calls.join(' ')).not.toMatch(/NaN|Infinity/);
        }
      });
      it('draws the wave labels of the chosen degree, and relabels when it changes', () => {
        const a = stubCtx();
        tool.draw(a.ctx, pts, view(tool, anchors), { selected: false });
        expect(a.texts).toEqual(c.texts);
        const b = stubCtx();
        tool.draw(b.ctx, pts, view(tool, anchors, { degree: 'minor' }), { selected: false });
        expect(b.texts).toEqual(c.minor);
      });
      it('lists every point price and time when selected, nothing otherwise', () => {
        expect(tool.axisLabels!(anchors, {}, false)).toEqual({});
        expect(tool.axisLabels!(anchors, {}, true)).toEqual({ price: anchors.map((x) => x.price), time: anchors.map((x) => x.time) });
      });
    });
  }
});
