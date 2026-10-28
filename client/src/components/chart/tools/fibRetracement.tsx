import { FIB_LEVELS, HIT_TOLERANCE, fibLevelPrices } from '../../../lib/drawingGeometry';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import type { DrawingTool, ToolView } from './types';

/** Pixel y of every level that is on the price scale, with its ratio and price. */
function levels(view: ToolView): { ratio: number; price: number; y: number }[] {
  const [start, end] = view.anchors;
  const prices = fibLevelPrices(start.price, end.price);
  const out: { ratio: number; price: number; y: number }[] = [];
  prices.forEach((price, i) => {
    const y = view.priceToY(price);
    if (y !== null) out.push({ ratio: FIB_LEVELS[i], price, y });
  });
  return out;
}

export const fibRetracement: DrawingTool = {
  id: 'fibRetracement',
  label: 'Fibonacci retracement',
  icon: (
    <Svg>
      <line x1="3" y1="5" x2="21" y2="5" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="3" y1="14" x2="21" y2="14" />
      <line x1="3" y1="19" x2="21" y2="19" />
    </Svg>
  ),
  anchors: 2,
  draw(ctx, [a, b], view, { selected }) {
    const x0 = Math.min(a.x, b.x);
    const x1 = Math.max(a.x, b.x);
    ctx.lineWidth = selected ? 1.5 : 1;
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'bottom';
    for (const l of levels(view)) {
      ctx.beginPath();
      ctx.moveTo(x0, l.y);
      ctx.lineTo(x1, l.y);
      ctx.strokeStyle = selected ? theme.accent2 : theme.accent;
      ctx.stroke();
      ctx.fillStyle = theme.muted;
      ctx.textAlign = 'left';
      ctx.fillText(`${l.ratio} (${view.formatPrice(l.price)})`, Math.max(2, Math.min(x0 + 4, view.width - 110)), l.y - 2);
    }
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.muted2;
    ctx.stroke();
    ctx.restore();
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    const x0 = Math.min(pts[0].x, pts[1].x);
    const x1 = Math.max(pts[0].x, pts[1].x);
    if (p.x < x0 - tolerance || p.x > x1 + tolerance) return false;
    return levels(view).some((l) => Math.abs(p.y - l.y) <= tolerance);
  },
  handles: (pts) => pts,
};
