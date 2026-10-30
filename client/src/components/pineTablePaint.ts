import { labelFont } from '../lib/pine/labelGeometry';
import { tableLayout, TABLE_PAD, type TableLayout } from '../lib/pine/tableLayout';
import type { PineTable } from '../lib/pine/types';

type Ctx = CanvasRenderingContext2D;

/** Paints one table pinned in a pane of `width` x `height`; returns its layout (cell boxes are the hover areas). */
export function paintTable(ctx: Ctx, t: PineTable, width: number, height: number): TableLayout {
  const layout = tableLayout(t, { width, height }, (s, font) => {
    ctx.font = font;
    return ctx.measureText(s).width;
  });
  const { origin, cells } = layout;
  if (layout.width === 0 || layout.height === 0) return layout;
  if (t.bgColor) {
    ctx.fillStyle = t.bgColor;
    ctx.fillRect(origin.x, origin.y, layout.width, layout.height);
  }
  for (const b of cells) {
    if (!b.cell.bgColor) continue;
    ctx.fillStyle = b.cell.bgColor;
    ctx.fillRect(origin.x + b.x, origin.y + b.y, b.w, b.h);
  }
  if (t.borderColor && t.borderWidth > 0) {
    ctx.strokeStyle = t.borderColor;
    ctx.lineWidth = t.borderWidth;
    for (const b of cells) ctx.strokeRect(origin.x + b.x, origin.y + b.y, b.w, b.h);
  }
  if (t.frameColor && t.frameWidth > 0) {
    ctx.strokeStyle = t.frameColor;
    ctx.lineWidth = t.frameWidth;
    ctx.strokeRect(origin.x, origin.y, layout.width, layout.height);
  }
  ctx.textBaseline = 'middle';
  for (const b of cells) {
    const c = b.cell;
    if (!c.textColor || b.lines.length === 0) continue;
    ctx.font = labelFont(c);
    ctx.fillStyle = c.textColor;
    ctx.textAlign = c.halign;
    const lh = c.textSize * 1.25;
    const block = lh * b.lines.length;
    const x0 = origin.x + b.x;
    const y0 = origin.y + b.y;
    const x = c.halign === 'left' ? x0 + TABLE_PAD : c.halign === 'right' ? x0 + b.w - TABLE_PAD : x0 + b.w / 2;
    const top = c.valign === 'top' ? y0 + TABLE_PAD : c.valign === 'bottom' ? y0 + b.h - TABLE_PAD - block : y0 + (b.h - block) / 2;
    b.lines.forEach((line, i) => ctx.fillText(line, x, top + lh * (i + 0.5)));
  }
  return layout;
}
