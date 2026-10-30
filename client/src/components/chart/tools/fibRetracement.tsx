import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { DEFAULT_LEVELS, cssColor, type FibLevel } from '../../../lib/drawingStyle';
import { fibLevelPrices } from '../../../lib/geometry/fib';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { boolField, opacityField } from './fields';
import { drawLevelLabel, enabledLevels, levelLabel } from './fibLevels';
import type { DrawingTool, ToolView } from './types';

type Level = { ratio: number; price: number; y: number; color: string };

/** Pixel y of every enabled level that is on the price scale. */
function levels(view: ToolView): Level[] {
  const [start, end] = view.anchors;
  const on: FibLevel[] = enabledLevels(view.style);
  const prices = fibLevelPrices(start.price, end.price, on.map((l) => l.value), view.style.reverse === true);
  const out: Level[] = [];
  prices.forEach((price, i) => {
    const y = view.priceToY(price);
    if (y !== null) out.push({ ratio: on[i].value, price, y, color: on[i].color });
  });
  return out;
}

/** The pixel x range the levels span: the anchors', continued to the right edge when the lines extend. */
function xRange(pts: { x: number }[], view: ToolView): [number, number] {
  const x0 = Math.min(pts[0].x, pts[1].x);
  const x1 = Math.max(pts[0].x, pts[1].x);
  return [x0, view.style.extendLines === true ? Math.max(x1, view.width) : x1];
}

export const fibRetracement: DrawingTool = {
  id: 'fibRetracement',
  label: 'Fibonacci retracement',
  group: 'fib-gann',
  section: 'Fibonacci',
  icon: (
    <Svg>
      <line x1="3" y1="5" x2="21" y2="5" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <line x1="3" y1="14" x2="21" y2="14" />
      <line x1="3" y1="19" x2="21" y2="19" />
    </Svg>
  ),
  anchors: 2,
  settings: [
    { key: 'levels', label: 'Levels', kind: 'levels', tab: 'style', default: DEFAULT_LEVELS },
    boolField('showLevels', 'Show levels', true),
    boolField('showPrices', 'Show prices', true),
    boolField('reverse', 'Reverse', false),
    boolField('extendLines', 'Extend lines', false),
    boolField('background', 'Background', false),
    opacityField('backgroundOpacity', 'Background opacity', 0.12),
  ],
  draw(ctx, [a, b], view, { selected }) {
    const [x0, x1] = xRange([a, b], view);
    const ls = levels(view);
    if (view.style.background === true) {
      for (let i = 1; i < ls.length; i++) {
        ctx.fillStyle = cssColor(ls[i].color, view.style.backgroundOpacity as number);
        const top = Math.min(ls[i - 1].y, ls[i].y);
        ctx.fillRect(x0, top, x1 - x0, Math.abs(ls[i].y - ls[i - 1].y));
      }
    }
    ctx.lineWidth = selected ? 1.5 : 1;
    const showLevel = view.style.showLevels === true;
    const showPrice = view.style.showPrices === true;
    for (const l of ls) {
      ctx.beginPath();
      ctx.moveTo(x0, l.y);
      ctx.lineTo(x1, l.y);
      ctx.strokeStyle = selected && !view.styled ? theme.accent2 : cssColor(l.color);
      ctx.stroke();
      if (!showLevel && !showPrice) continue;
      const label = levelLabel(l.ratio, view.formatPrice(l.price), showLevel, showPrice);
      drawLevelLabel(ctx, label, Math.max(2, Math.min(x0 + 4, view.width - 110)), l.y - 2);
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
    const [x0, x1] = xRange(pts, view);
    if (p.x < x0 - tolerance || p.x > x1 + tolerance) return false;
    return levels(view).some((l) => Math.abs(p.y - l.y) <= tolerance);
  },
  handles: (pts) => pts,
};
