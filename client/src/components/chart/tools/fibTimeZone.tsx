import { HIT_TOLERANCE, logicalToTime, timeToLogical } from '../../../lib/drawingGeometry';
import { FIB_TIME_ZONE_TABLE, cssColor } from '../../../lib/drawingStyle';
import { fibTimeLogical, fibTimeX } from '../../../lib/geometry/fib';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { applyDash, boolField, lineStyleField, opacityField, widthField } from './fields';
import { drawLevelLabel, enabledLevels } from './fibLevels';
import type { DrawingTool, ToolView } from './types';

type Line = { n: number; x: number; color: string };

/** The vertical lines that are on and inside the pane (with a little margin), left to right. */
function lines(pts: { x: number }[], view: ToolView): Line[] {
  if (pts.length < 2) return [];
  return enabledLevels(view.style)
    .map((l) => ({ n: l.value, x: fibTimeX(pts[0].x, pts[1].x, l.value), color: l.color }))
    .filter((l) => Number.isFinite(l.x) && l.x >= -HIT_TOLERANCE && l.x <= view.width + HIT_TOLERANCE)
    .sort((a, b) => a.x - b.x);
}

/** Vertical lines at the Fibonacci bar counts from point 1, one unit being the bars from point 1 to point 2. */
export const fibTimeZone: DrawingTool = {
  id: 'fibTimeZone',
  label: 'Fib time zone',
  group: 'fib-gann',
  section: 'Fibonacci',
  icon: (
    <Svg>
      <line x1="4" y1="4" x2="4" y2="20" />
      <line x1="8" y1="4" x2="8" y2="20" />
      <line x1="13" y1="4" x2="13" y2="20" />
      <line x1="20" y1="4" x2="20" y2="20" />
    </Svg>
  ),
  anchors: 2,
  fullHeight: true,
  settings: [
    { key: 'levels', label: 'Levels', kind: 'levels', tab: 'style', default: FIB_TIME_ZONE_TABLE },
    widthField('width', 'Width', 1),
    lineStyleField('lineStyle', 'Line style'),
    boolField('background', 'Background', false),
    opacityField('backgroundOpacity', 'Background opacity', 0.1),
    boolField('showLabels', 'Show labels', true, 'text'),
  ],
  axisLabels(anchors, style, selected, times = []) {
    if (!selected || anchors.length < 2 || times.length === 0) return {};
    const l0 = timeToLogical(times, anchors[0].time);
    const l1 = timeToLogical(times, anchors[1].time);
    const levels = (style.levels as { value: number; on: boolean }[] | undefined) ?? [];
    return { time: levels.filter((l) => l.on).map((l) => logicalToTime(times, fibTimeLogical(l0, l1, l.value))).filter(Number.isFinite) };
  },
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
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
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[1].x, pts[1].y);
    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.muted2;
    ctx.stroke();
    ctx.restore();
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    const ls = lines(pts, view);
    if (view.style.background === true && ls.length > 1 && p.x >= ls[0].x && p.x <= ls[ls.length - 1].x) return true;
    return ls.some((l) => Math.abs(p.x - l.x) <= tolerance);
  },
  handles: (pts) => pts,
};
