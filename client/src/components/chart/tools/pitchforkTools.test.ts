import { describe, expect, it } from 'vitest';
import type { Pt } from '../../../lib/drawingGeometry';
import { resolveStyle } from '../../../lib/drawingStyle';
import { insidePitchfork, modifiedSchiffPitchfork, pitchfork, schiffPitchfork } from './pitchfork';
import type { DrawingTool, ToolView } from './types';

const W = 400;
const H = 300;
const bars = [10, 12, 11, 15, 14, 18].map((c, i) => ({ time: (i + 1) * 60, open: c, high: c + 1, low: c - 1, close: c }));

function view(tool: DrawingTool, style?: Record<string, unknown>, candles = bars): ToolView {
  return {
    width: W,
    height: H,
    anchors: [],
    text: '',
    times: candles.map((c) => c.time),
    candles,
    priceToY: (p) => H - p * 10,
    formatPrice: String,
    style: resolveStyle(tool.settings ?? [], style, undefined).values,
    styled: false,
    glyph: '',
    cells: [],
  };
}

function stubCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
  const calls: string[] = [];
  const ctx = new Proxy({} as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : (...a: unknown[]) => void calls.push(`${k}(${a.map((x) => (typeof x === 'number' ? Math.round(x) : '')).join(',')})`)),
    set: (t, k: string, v) => ((t[k] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

const tools: [DrawingTool, string][] = [
  [pitchfork, 'original'],
  [schiffPitchfork, 'schiff'],
  [modifiedSchiffPitchfork, 'modifiedSchiff'],
  [insidePitchfork, 'inside'],
];
const P: Pt[] = [{ x: 40, y: 250 }, { x: 100, y: 100 }, { x: 160, y: 200 }];
// M = (130,150); the Pitchfork median runs from (40,250) through M.

describe('the registry entries', () => {
  it('sit in the Lines group, section Pitchforks, with three anchors', () => {
    expect(tools.map(([t]) => [t.id, t.group, t.section, t.anchors])).toEqual([
      ['pitchfork', 'lines', 'Pitchforks', 3],
      ['schiffPitchfork', 'lines', 'Pitchforks', 3],
      ['modifiedSchiffPitchfork', 'lines', 'Pitchforks', 3],
      ['insidePitchfork', 'lines', 'Pitchforks', 3],
    ]);
  });
  it('default to TradingView settings', () => {
    for (const [t, variant] of tools) {
      const s = view(t).style;
      expect(s).toMatchObject({ variant, medianColor: '#F23645', medianWidth: 2, medianLineStyle: 'solid', showMedian: true, background: true, backgroundOpacity: 0.2, extendLines: false });
      const levels = s.levels as { value: number; color: string; on: boolean }[];
      expect(levels.map((l) => l.value)).toEqual([0.25, 0.382, 0.5, 0.618, 0.75, 1, 1.5, 1.75, 2]);
      expect(levels.filter((l) => l.on).map((l) => l.value)).toEqual([0.5, 1]);
      expect(levels[5].color).toBe('#2962FF');
    }
  });
  it('fall back to the default levels for a bad stored value', () => {
    expect((view(pitchfork, { levels: 'nope' }).style.levels as unknown[]).length).toBe(9);
  });
});

describe('a partial draft', () => {
  it('never throws for 0 to 3 points, also with coincident points and no bars', () => {
    const same: Pt[] = [{ x: 10, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 10 }];
    for (const [t] of tools) {
      for (const pts of [P, same]) {
        for (let n = 0; n <= 3; n++) {
          const { ctx } = stubCtx();
          const v = view(t, undefined, []);
          expect(() => t.draw(ctx, pts.slice(0, n), v, { selected: true })).not.toThrow();
          expect(() => t.hit(pts.slice(0, n), { x: 5, y: 5 }, v)).not.toThrow();
          expect(() => t.handles(pts.slice(0, n), v)).not.toThrow();
        }
      }
    }
  });
  it('previews the first tine with two points', () => {
    const { ctx, calls } = stubCtx();
    pitchfork.draw(ctx, P.slice(0, 2), view(pitchfork), { selected: false });
    expect(calls).toContain('moveTo(40,250)');
    expect(calls).toContain('lineTo(100,100)');
  });
});

describe('hit and handles', () => {
  it('returns the three anchors as handles', () => {
    for (const [t] of tools) expect(t.handles(P, view(t))).toEqual(P);
  });
  it('hits the median, an enabled level line, the handle line and the fill; misses a disabled level', () => {
    const v = view(pitchfork);
    expect(pitchfork.hit(P, { x: 85, y: 200 }, v)).toBe(true); // median
    expect(pitchfork.hit(P, { x: 130, y: 150 }, v)).toBe(true); // M on the handle line
    // level 0.5 starts at M + 0.5(P3-M) = (145,175); 20 px along the median direction
    const d = { x: 90, y: -100 };
    const n = Math.hypot(d.x, d.y);
    expect(pitchfork.hit(P, { x: 145 + (d.x / n) * 20, y: 175 + (d.y / n) * 20 }, v)).toBe(true);
    // between median and level 0.5 is the fill
    expect(pitchfork.hit(P, { x: 137.5 + (d.x / n) * 30, y: 162.5 + (d.y / n) * 30 }, v)).toBe(true);
    // a point on level 0.618 (disabled) outside any fill: beyond level 1 on the positive side
    const q = { x: 130 + 1.3 * 30 + (d.x / n) * 40, y: 150 + 1.3 * 50 + (d.y / n) * 40 };
    expect(pitchfork.hit(P, q, v)).toBe(false);
  });
  it('misses a little off the lines with Background off', () => {
    const v = view(pitchfork, { background: false });
    const d = { x: 90, y: -100 };
    const n = Math.hypot(d.x, d.y);
    expect(pitchfork.hit(P, { x: 137.5 + (d.x / n) * 30, y: 162.5 + (d.y / n) * 30 }, v)).toBe(false);
  });
});

describe('the Style choice', () => {
  it('changes the median origin', () => {
    const start = (variant: string) => {
      const { ctx, calls } = stubCtx();
      pitchfork.draw(ctx, P, view(pitchfork, { variant, levels: [], background: false }), { selected: false });
      return calls.filter((c) => c.startsWith('moveTo'))[0];
    };
    expect(start('original')).toBe('moveTo(40,250)');
    expect(start('schiff')).toBe('moveTo(40,175)');
    expect(start('modifiedSchiff')).toBe('moveTo(70,175)');
    expect(start('inside')).not.toBe(start('original'));
  });
});
