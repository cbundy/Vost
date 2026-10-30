import type { Pt } from '../lib/drawingGeometry';
import { labelAnchor, labelFont, labelLayout, type LabelLayout, type LabelShape } from '../lib/pine/labelGeometry';
import type { PineLabel } from '../lib/pine/types';

type Ctx = CanvasRenderingContext2D;

function roundRect(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x0 + r, y0);
  ctx.arcTo(x1, y0, x1, y1, r);
  ctx.arcTo(x1, y1, x0, y1, r);
  ctx.arcTo(x0, y1, x0, y0, r);
  ctx.arcTo(x0, y0, x1, y0, r);
  ctx.closePath();
}

function shapePath(ctx: Ctx, type: LabelShape, cx: number, cy: number, size: number): 'fill' | 'stroke' {
  const r = size / 2;
  ctx.beginPath();
  switch (type) {
    case 'circle':
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      return 'fill';
    case 'square':
      ctx.rect(cx - r, cy - r, size, size);
      return 'fill';
    case 'diamond':
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      return 'fill';
    case 'triangleup':
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r);
      ctx.lineTo(cx - r, cy + r);
      ctx.closePath();
      return 'fill';
    case 'triangledown':
      ctx.moveTo(cx, cy + r);
      ctx.lineTo(cx + r, cy - r);
      ctx.lineTo(cx - r, cy - r);
      ctx.closePath();
      return 'fill';
    case 'arrowup':
    case 'arrowdown': {
      const s = type === 'arrowup' ? 1 : -1;
      // a head on a stem, pointing up (s = 1) or down
      ctx.moveTo(cx, cy - s * r);
      ctx.lineTo(cx + r, cy);
      ctx.lineTo(cx + r / 3, cy);
      ctx.lineTo(cx + r / 3, cy + s * r);
      ctx.lineTo(cx - r / 3, cy + s * r);
      ctx.lineTo(cx - r / 3, cy);
      ctx.lineTo(cx - r, cy);
      ctx.closePath();
      return 'fill';
    }
    case 'flag':
      ctx.moveTo(cx - r, cy + r);
      ctx.lineTo(cx - r, cy - r);
      ctx.lineTo(cx + r, cy - r / 3);
      ctx.lineTo(cx - r, cy + r / 3);
      return 'fill';
    case 'cross':
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      return 'stroke';
    case 'xcross':
      ctx.moveTo(cx - r, cy - r);
      ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r);
      ctx.lineTo(cx - r, cy + r);
      return 'stroke';
  }
}

/** Paints one label with its bar's pixel at `at`; returns its layout (its bounds are the hit area), null when off the chart. */
export function paintLabel(ctx: Ctx, l: PineLabel, at: Pt): LabelLayout {
  const font = labelFont(l);
  ctx.font = font;
  const layout = labelLayout(l, labelAnchor(l, at), (s) => ctx.measureText(s).width);
  const colour = l.color;
  if (layout.kind === 'bubble' && colour) {
    ctx.fillStyle = colour;
    const r = layout.rect!;
    roundRect(ctx, r.x0, r.y0, r.x1, r.y1, 3);
    ctx.fill();
    if (layout.pointer.length) {
      ctx.beginPath();
      layout.pointer.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
    }
  } else if (layout.kind === 'shape' && colour && layout.shape) {
    const s = layout.shape;
    const how = shapePath(ctx, s.type, s.cx, s.cy, s.size);
    if (how === 'fill') {
      ctx.fillStyle = colour;
      ctx.fill();
    } else {
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  if (l.textColor && layout.lines.length) {
    ctx.font = font;
    ctx.textAlign = l.textAlign;
    ctx.textBaseline = 'middle';
    for (const line of layout.lines) {
      if (layout.outline) {
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = l.color ?? '#000000';
        ctx.strokeText(line.text, line.x, line.y);
      }
      ctx.fillStyle = l.textColor;
      ctx.fillText(line.text, line.x, line.y);
    }
  }
  return layout;
}
