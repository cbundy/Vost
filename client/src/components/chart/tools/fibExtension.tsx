import { HIT_TOLERANCE, distToSegment, type Pt } from '../../../lib/drawingGeometry';
import { FIB_EXTENSION_TABLE, cssColor } from '../../../lib/drawingStyle';
import { extensionPrices } from '../../../lib/geometry/fib';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { anchorLabels } from './channelShared';
import { applyDash, boolField, lineStyleField, opacityField, widthField } from './fields';
import { drawLevelLabel, drawPath, enabledLevels, levelLabel } from './fibLevels';
import type { DrawingTool, ToolView } from './types';

type Level = { ratio: number; price: number; y: number; color: string };

/** Pixel y of every enabled level that is on the price scale. */
function levels(view: ToolView): Level[] {
  if (view.anchors.length < 3) return [];
  const [a, b, c] = view.anchors;
  const on = enabledLevels(view.style);
  const prices = extensionPrices(a.price, b.price, c.price, on.map((l) => l.value), view.style.reverse === true);
  const out: Level[] = [];
  prices.forEach((price, i) => {
    const y = view.priceToY(price);
    if (y !== null && Number.isFinite(y)) out.push({ ratio: on[i].value, price, y, color: on[i].color });
  });
  return out;
}

/** The pixel x range the levels span: from B to C, continued to the pane edges when they extend. */
function xRange(pts: Pt[], view: ToolView): [number, number] {
  const lo = Math.min(pts[1].x, pts[2].x);
  const hi = Math.max(pts[1].x, pts[2].x);
  return [view.style.extendLeft === true ? Math.min(lo, 0) : lo, view.style.extendRight === true ? Math.max(hi, view.width) : hi];
}

/** The percent label: the level's distance from C, one decimal and a sign. */
export function percentLabel(price: number, c: number): string {
  if (!(c !== 0) || !Number.isFinite(price)) return '';
  const pct = ((price - c) / c) * 100;
  return `${pct >= 0 ? '+' : '-'}${Math.abs(pct).toFixed(1)}%`;
}

/** Levels measured from point C in the direction and length of A to B. */
export const fibExtension: DrawingTool = {
  id: 'fibExtension',
  label: 'Trend-based fib extension',
  group: 'fib-gann',
  section: 'Fibonacci',
  icon: (
    <Svg>
      <polyline points="3,20 9,10 13,15" />
      <line x1="11" y1="5" x2="21" y2="5" />
      <line x1="11" y1="9" x2="21" y2="9" />
      <line x1="11" y1="13" x2="21" y2="13" />
    </Svg>
  ),
  anchors: 3,
  settings: [
    { key: 'levels', label: 'Levels', kind: 'levels', tab: 'style', default: FIB_EXTENSION_TABLE },
    widthField('width', 'Width', 1),
    lineStyleField('lineStyle', 'Line style'),
    boolField('background', 'Background', false),
    opacityField('backgroundOpacity', 'Background opacity', 0.12),
    boolField('reverse', 'Reverse', false),
    boolField('extendLeft', 'Extend left', false),
    boolField('extendRight', 'Extend right', false),
    boolField('showLevels', 'Show levels', true, 'text'),
    boolField('showPrices', 'Show prices', true, 'text'),
    boolField('showPercent', 'Show percent', false, 'text'),
  ],
  axisLabels: (anchors, _style, selected) => anchorLabels(anchors, selected),
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    if (pts.length < 3) {
      ctx.strokeStyle = theme.muted2;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    const [x0, x1] = xRange(pts, view);
    const ls = levels(view);
    if (view.style.background === true) {
      for (let i = 1; i < ls.length; i++) {
        ctx.fillStyle = cssColor(ls[i].color, view.style.backgroundOpacity as number);
        ctx.fillRect(x0, Math.min(ls[i - 1].y, ls[i].y), x1 - x0, Math.abs(ls[i].y - ls[i - 1].y));
      }
    }
    ctx.lineWidth = (view.style.width as number) + (selected ? 0.5 : 0);
    const showLevel = view.style.showLevels === true;
    const showPrice = view.style.showPrices === true;
    const showPercent = view.style.showPercent === true;
    ctx.save();
    applyDash(ctx, view.style.lineStyle);
    for (const l of ls) {
      ctx.beginPath();
      ctx.moveTo(x0, l.y);
      ctx.lineTo(x1, l.y);
      ctx.strokeStyle = selected && !view.styled ? theme.accent2 : cssColor(l.color);
      ctx.stroke();
    }
    ctx.restore();
    for (const l of ls) {
      if (!showLevel && !showPrice && !showPercent) break;
      const base = showLevel || showPrice ? levelLabel(l.ratio, view.formatPrice(l.price), showLevel, showPrice) : '';
      const pct = showPercent ? percentLabel(l.price, view.anchors[2].price) : '';
      drawLevelLabel(ctx, [base, pct].filter(Boolean).join(' '), Math.max(2, Math.min(x0 + 4, view.width - 110)), l.y - 2);
    }
    drawPath(ctx, pts);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 2) return false;
    if (pts.length < 3) return distToSegment(p, pts[0], pts[1]) <= tolerance;
    if (distToSegment(p, pts[0], pts[1]) <= tolerance || distToSegment(p, pts[1], pts[2]) <= tolerance) return true;
    const [x0, x1] = xRange(pts, view);
    const ls = levels(view);
    if (ls.some((l) => p.x >= x0 - tolerance && p.x <= x1 + tolerance && Math.abs(p.y - l.y) <= tolerance)) return true;
    if (view.style.background !== true || p.x < x0 || p.x > x1) return false;
    return ls.some((l, i) => i > 0 && p.y >= Math.min(ls[i - 1].y, l.y) && p.y <= Math.max(ls[i - 1].y, l.y));
  },
  handles: (pts) => pts,
};
