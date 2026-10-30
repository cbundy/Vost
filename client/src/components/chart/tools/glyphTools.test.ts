import { describe, expect, it, vi } from 'vitest';
import { resolveStyle, validateValue } from '../../../lib/drawingStyle';
import { loadSet } from '../../../lib/iconSets';
import { ANCHOR_COUNTS, GLYPH_TOOLS, TOOLS, VALIDATORS } from './index';
import { emoji, glyphTools, icon, sticker } from './glyph';
import type { DrawingTool, ToolView } from './types';

const W = 400;
const H = 300;
function view(tool: DrawingTool, glyph: string, style?: Record<string, unknown>): ToolView {
  return { width: W, height: H, anchors: [], candles: [], text: '', cells: [], times: [], priceToY: () => null, formatPrice: String, style: resolveStyle(tool.settings ?? [], style).values, styled: false, glyph };
}
/** A canvas that records the calls it receives, so a test can see what was painted. */
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy({}, { get: (_t, name) => (...args: unknown[]) => void calls.push(`${String(name)}:${args.map(String).join(',')}`), set: () => true }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}
const c = { x: 200, y: 150 };

describe('glyph tools', () => {
  it('are the Icons, Emojis and Stickers tools of the icons family with one anchor each, last in the registry', () => {
    expect(glyphTools.map((t) => t.id)).toEqual(['icon', 'emoji', 'sticker']);
    expect(glyphTools.map((t) => t.label)).toEqual(['Icons', 'Emojis', 'Stickers']);
    for (const t of glyphTools) {
      expect(t.group).toBe('icons');
      expect(t.glyph).toBe(true);
      expect(ANCHOR_COUNTS[t.id]).toBe(1);
      expect(GLYPH_TOOLS.has(t.id)).toBe(true);
    }
    expect(TOOLS.slice(-3).map((t) => t.id)).toEqual(['icon', 'emoji', 'sticker']);
  });
  it('declare Size, Angle, Opacity (and Colour for icons) whose defaults validate: 40, 40 and 80', () => {
    for (const t of glyphTools) for (const f of t.settings!) expect(validateValue(f, f.default), `${t.id}.${f.key}`).toBeDefined();
    expect(view(icon, 'x').style).toMatchObject({ size: 40, angle: 0, opacity: 1, color: 'accent' });
    expect(view(emoji, 'x').style).toMatchObject({ size: 40, angle: 0, opacity: 1 });
    expect(view(emoji, 'x').style).not.toHaveProperty('color');
    expect(view(sticker, 'x').style.size).toBe(80);
    const size = icon.settings!.find((f) => f.key === 'size')!;
    expect([size.min, size.max]).toEqual([8, 512]);
  });

  it('validate drops a drawing without a glyph and keeps an unknown one', () => {
    const base = { id: 'a', tool: 'icon', anchors: [{ time: 1, price: 2 }] };
    expect(VALIDATORS.icon({ ...base })).toBeNull();
    expect(VALIDATORS.icon({ ...base, glyph: '' })).toBeNull();
    expect(VALIDATORS.icon({ ...base, glyph: 7 as unknown as string })).toBeNull();
    expect(VALIDATORS.emoji({ ...base, tool: 'emoji', glyph: 'no-such-id' })).toMatchObject({ glyph: 'no-such-id' });
  });

  it('draw without throwing: no bars, an unknown id (placeholder), before the set or image has loaded', async () => {
    const empty = { ...view(icon, 'x'), width: 0, height: 0 };
    for (const t of glyphTools) {
      for (const v of [view(t, 'no-such-id'), view(t, ''), { ...view(t, 'no-such-id'), width: 0, height: 0 }, empty]) {
        expect(() => t.draw(recorder().ctx, [c], v, { selected: true })).not.toThrow();
        expect(() => t.draw(recorder().ctx, [c], v, { selected: false })).not.toThrow();
      }
    }
    // The set is not loaded yet: a dashed placeholder box, no question mark and no image.
    const loading = recorder();
    sticker.draw(loading.ctx, [c], view(sticker, 'anything'), { selected: false });
    expect(loading.calls.some((x) => x.startsWith('setLineDash:4,3'))).toBe(true);
    expect(loading.calls.some((x) => x.startsWith('fillText'))).toBe(false);
    expect(loading.calls.some((x) => x.startsWith('drawImage'))).toBe(false);
    await loadSet('sticker');
    const missing = recorder();
    sticker.draw(missing.ctx, [c], view(sticker, 'anything'), { selected: false });
    expect(missing.calls.some((x) => x.startsWith('fillText:?'))).toBe(true);
  });

  it('draws a known icon as a stroke in its colour, sized and turned by its style', async () => {
    const entries = await loadSet('icon');
    const id = entries.find((e) => e.id === 'flag')!.id;
    const r = recorder();
    vi.stubGlobal('Path2D', class { addPath() {} });
    try {
      icon.draw(r.ctx, [c], view(icon, id, { size: 48, angle: 90, color: '#ff0000' }), { selected: false });
    } finally {
      vi.unstubAllGlobals();
    }
    expect(r.calls).toContain('translate:200,150');
    expect(r.calls.some((x) => x.startsWith(`rotate:${Math.PI / 2}`))).toBe(true);
    expect(r.calls).toContain('scale:2,2');
    expect(r.calls.some((x) => x.startsWith('stroke'))).toBe(true);
  });

  it('leaves the canvas as it found it (the selection handles are painted after the draw, in chart pixels)', () => {
    for (const t of glyphTools) {
      for (const selected of [true, false]) {
        const r = recorder();
        t.draw(r.ctx, [c], view(t, 'no-such-id', { angle: 30 }), { selected });
        const n = (name: string) => r.calls.filter((x) => x.startsWith(`${name}:`)).length;
        expect(n('save'), `${t.id} selected=${selected}`).toBe(n('restore'));
        expect(n('rotate')).toBeGreaterThan(0);
      }
    }
  });

  it('hit on the rotated box, not on the upright one it left', () => {
    const upright = view(emoji, 'x', { size: 40, angle: 0 });
    const turned = view(emoji, 'x', { size: 40, angle: 45 });
    const corner = { x: c.x + 19, y: c.y - 19 };
    expect(emoji.hit([c], corner, upright, 0)).toBe(true);
    expect(emoji.hit([c], corner, turned, 0)).toBe(false);
    expect(emoji.hit([c], { x: c.x, y: c.y - 27 }, turned, 0)).toBe(true);
    expect(emoji.hit([c], { x: c.x + 60, y: c.y }, upright, 0)).toBe(false);
  });

  it('has four corner handles and a rotation handle above the top edge, turned with the box', () => {
    const hs = icon.handles([c], view(icon, 'x', { size: 40, angle: 0 }));
    expect(hs).toHaveLength(5);
    expect(hs.slice(0, 4).map((p) => [p.x, p.y])).toEqual([[180, 130], [220, 130], [220, 170], [180, 170]]);
    expect(hs[4]).toEqual({ x: 200, y: 106 });
    const turned = icon.handles([c], view(icon, 'x', { size: 40, angle: 90 }));
    expect(turned[4].x).toBeCloseTo(244, 6);
    expect(turned[4].y).toBeCloseTo(150, 6);
  });

  it('dragStyle: a corner changes the size, the rotation handle the angle (Shift snaps to 15 degrees), others nothing', () => {
    const v = view(sticker, 'x');
    expect(sticker.dragStyle!([c], 1, { x: c.x + 50, y: c.y - 50 }, v, { shift: false })).toEqual({ size: 100 });
    expect(sticker.dragStyle!([c], 2, { x: c.x + 1000, y: c.y + 1000 }, v, { shift: false })).toEqual({ size: 512 });
    expect(sticker.dragStyle!([c], 3, c, v, { shift: false })).toEqual({ size: 8 });
    const at = (deg: number) => ({ x: c.x + 60 * Math.sin((deg * Math.PI) / 180), y: c.y - 60 * Math.cos((deg * Math.PI) / 180) });
    expect(sticker.dragStyle!([c], 4, at(38), v, { shift: false })).toEqual({ angle: 38 });
    expect(sticker.dragStyle!([c], 4, at(38), v, { shift: true })).toEqual({ angle: 45 });
    expect(sticker.dragStyle!([c], 4, at(-10), v, { shift: true })).toEqual({ angle: 345 });
    expect(sticker.dragStyle!([c], 9, c, v, { shift: false })).toBeNull();
  });
});
