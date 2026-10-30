import { HIT_TOLERANCE, distToSegment, logicalToTime, timeToLogical } from '../../../lib/drawingGeometry';
import { FIB_TREND_TIME_TABLE, cssColor } from '../../../lib/drawingStyle';
import { trendTimeLogical, trendTimeX } from '../../../lib/geometry/fib';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { applyDash, boolField, lineStyleField, opacityField, widthField } from './fields';
import { drawLevelLabel, drawPath, enabledLevels } from './fibLevels';
import type { DrawingTool, ToolView } from './types';

type Line = { n: number; x: number; color: string };

/** The vertical lines that are on and inside the pane (with a little margin), left to right. */
function lines(pts: { x: number }[], view: ToolView): Line[] {
  if (pts.length < 3) return [];
  return enabledLevels(view.style)
    .map((l) => ({ n: l.value, x: trendTimeX(pts[0].x, pts[1].x, pts[2].x, l.value), color: l.color }))
    .filter((l) => Number.isFinite(l.x) && l.x >= -HIT_TOLERANCE && l.x <= view.width + HIT_TOLERANCE)
    .sort((a, b) => a.x - b.x);
}

/** Vertical lines at x_C + (x_B - x_A) * ratio. */
export const fibTrendTime: DrawingTool = {
  id: 'fibTrendTime',
  label: 'Trend-based fib time',
  group: 'fib-gann',
  section: 'Fibonacci',
  icon: (
    <Svg>
      <polyline points="3,20 8,12 11,16" />
      <line x1="14" y1="4" x2="14" y2="20" />
      <line x1="17" y1="4" x2="17" y2="20" />
      <line x1="21" y1="4" x2="21" y2="20" />
    </Svg>
  ),
  anchors: 3,
  fullHeight: true,
  settings: [
    { key: 'levels', label: 'Levels', kind: 'levels', tab: 'style', default: FIB_TREND_TIME_TABLE },
    widthField('width', 'Width', 1),
    lineStyleField('lineStyle', 'Line style'),
    boolField('background', 'Background', false),
    opacityField('backgroundOpacity', 'Background opacity', 0.1),
    boolField('showLabels', 'Show labels', true, 'text'),
  ],
  axisLabels(anchors, style, selected, times = []) {
    if (!selected || anchors.length < 3 || times.length === 0) return {};
    const [la, lb, lc] = anchors.map((a) => timeToLogical(times, a.time));
    const levels = (style.levels as { value: number; on: boolean }[] | undefined) ?? [];
    return { time: levels.filter((l) => l.on).map((l) => logicalToTime(times, trendTimeLogical(la, lb, lc, l.value))).filter(Number.isFinite) };
  },
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    if (pts.length < 3) {
      drawPath(ctx, pts);
      return;
    }
    const ls = lines(pts, view);
    if (view.style.background === true) {
      for (let i = 1; i < ls.length; i++) {
        ctx.fillStyle = cssColor(ls[i].color, view.style.backgroundOpacity as number);
        ctx.fillRect(ls[i - 1].x, 0, ls[i].x - ls[i - 1].x, view.height);
      }
    }
    ctx.lineWidth = (view.style.width as number) + (selected ? 0.5 : 0);
    ctx.save();
    ctx.setLineDash([]);
    applyDash(ctx, view.style.lineStyle);
    for (const l of ls) {
      ctx.beginPath();
      ctx.moveTo(l.x, 0);
      ctx.lineTo(l.x, view.height);
      ctx.strokeStyle = selected && !view.styled ? theme.accent2 : cssColor(l.color);
      ctx.stroke();
    }
    ctx.restore();
    if (view.style.showLabels === true) for (const l of ls) drawLevelLabel(ctx, `${l.n}`, l.x + 3, view.height - 3);
    drawPath(ctx, pts);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 2) return false;
    if (pts.length < 3) return distToSegment(p, pts[0], pts[1]) <= tolerance;
    if (distToSegment(p, pts[0], pts[1]) <= tolerance || distToSegment(p, pts[1], pts[2]) <= tolerance) return true;
    const ls = lines(pts, view);
    if (view.style.background === true && ls.length > 1 && p.x >= ls[0].x && p.x <= ls[ls.length - 1].x) return true;
    return ls.some((l) => Math.abs(p.x - l.x) <= tolerance);
  },
  handles: (pts) => pts,
};
