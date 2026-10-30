import { HIT_TOLERANCE, logicalToTime, timeToLogical } from '../../../lib/drawingGeometry';
import { cycleXs } from '../../../lib/geometry/cycles';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { applyDash, colorField, lineStyleField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool, ToolView } from './types';

const xs = (pts: { x: number }[], view: ToolView) => (pts.length < 2 ? [] : cycleXs(pts[0].x, pts[1].x - pts[0].x, view.width, HIT_TOLERANCE));

/** Full height vertical lines at point 1 and every whole multiple of the bars from point 1 to point 2. */
export const cyclicLines: DrawingTool = {
  id: 'cyclicLines',
  label: 'Cyclic lines',
  group: 'patterns',
  section: 'Cycles',
  icon: (
    <Svg>
      <line x1="4" y1="5" x2="4" y2="19" />
      <line x1="10" y1="5" x2="10" y2="19" />
      <line x1="16" y1="5" x2="16" y2="19" />
      <line x1="22" y1="5" x2="22" y2="19" />
    </Svg>
  ),
  anchors: 2,
  fullHeight: true,
  settings: [colorField('color', 'Colour', 'accent'), widthField('width', 'Width', 1), lineStyleField('lineStyle', 'Line style')],
  axisLabels(anchors, _style, selected, times = []) {
    if (!selected || anchors.length < 2 || times.length === 0) return {};
    const l0 = timeToLogical(times, anchors[0].time);
    const period = timeToLogical(times, anchors[1].time) - l0;
    const out = [anchors[0].time, anchors[1].time];
    if (Number.isFinite(period) && period !== 0) {
      // Repeats beyond the loaded bars, a bounded number each way.
      for (let k = -30; k <= 30; k++) if (k !== 0 && k !== 1) out.push(logicalToTime(times, l0 + k * period));
    }
    return { time: out.filter(Number.isFinite) };
  },
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.lineWidth = strokeWidth(view, selected);
    ctx.strokeStyle = strokeColor(view, selected, theme.accent2, 'color', null);
    ctx.setLineDash([]);
    applyDash(ctx, view.style.lineStyle);
    for (const x of xs(pts, view)) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, view.height);
      ctx.stroke();
    }
    ctx.restore();
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    return xs(pts, view).some((x) => Math.abs(p.x - x) <= tolerance);
  },
  handles: (pts) => pts,
};
