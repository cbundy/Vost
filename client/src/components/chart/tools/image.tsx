import { HIT_TOLERANCE, pointInRect, rectCorners, type Pt } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { dragCorner, ratioOf } from '../../../lib/geometry/image';
import { MAX_SIDE, isImageKey } from '../../../lib/drawingImages';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { bitmapFor } from '../imageCache';
import { boolField, colorField, opacityField, widthField } from './fields';
import type { DrawingTool, ToolView } from './types';

const sideOk = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_SIDE;

/** The box the picture fills: the two anchors' corners. */
function box([a, b]: Pt[]): { x: number; y: number; w: number; h: number } {
  const [tl, , br] = rectCorners(a, b);
  return { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y };
}

/** The placeholder of a picture the store does not have: a dashed box with a label. */
function drawMissing(ctx: CanvasRenderingContext2D, r: { x: number; y: number; w: number; h: number }): void {
  ctx.save();
  ctx.fillStyle = 'rgba(148,163,184,0.12)';
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  ctx.setLineDash([]);
  ctx.fillStyle = theme.muted;
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Picture missing', r.x + r.w / 2, r.y + r.h / 2, Math.max(0, r.w - 8));
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, pts: Pt[], view: ToolView): void {
  if (pts.length < 2) return;
  const r = box(pts);
  if (r.w < 1 || r.h < 1) return;
  const state = view.image ? bitmapFor(view.image.key) : 'missing';
  if (state === 'missing') drawMissing(ctx, r);
  else if (state !== 'loading') {
    ctx.save();
    ctx.globalAlpha = view.style.opacity as number;
    ctx.drawImage(state, r.x, r.y, r.w, r.h);
    ctx.restore();
  }
  const bw = view.style.borderWidth as number;
  if (bw > 0) {
    ctx.save();
    ctx.strokeStyle = cssColor(view.style.borderColor);
    ctx.lineWidth = bw;
    ctx.setLineDash([]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }
}

export const image: DrawingTool = {
  id: 'image',
  label: 'Image',
  group: 'annotations',
  section: 'Content',
  icon: (
    <Svg>
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M4.5 17l4.5-4.5 3.5 3.5 2.5-2.5 4.5 4.5" />
    </Svg>
  ),
  anchors: 2,
  settings: [
    opacityField('opacity', 'Opacity', 1),
    colorField('borderColor', 'Border colour', 'accent'),
    widthField('borderWidth', 'Border width', 0, 0, 5),
    boolField('keepRatio', 'Keep ratio', true),
  ],
  validate(d) {
    const im = d.image as unknown;
    if (!im || typeof im !== 'object') return null;
    const { key, w, h } = im as Record<string, unknown>;
    if (!isImageKey(key) || !sideOk(w) || !sideOk(h)) return null;
    return { ...d, image: { key, w, h } };
  },
  draw,
  hit(pts, p, _view, tolerance = HIT_TOLERANCE) {
    return pointInRect(p, pts[0], pts[1], tolerance);
  },
  handles: ([a, b]) => rectCorners(a, b),
  dragHandle(origPts: Pt[], handle: number, p: Pt, mods) {
    const opposite = rectCorners(origPts[0], origPts[1])[(handle + 2) % 4];
    const free = !!mods?.shift || mods?.style?.keepRatio === false;
    return [opposite, dragCorner(opposite, p, ratioOf(origPts[0], origPts[1]), free)];
  },
};
