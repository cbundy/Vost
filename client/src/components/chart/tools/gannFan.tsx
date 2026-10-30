import { HIT_TOLERANCE, distToSegment, inFanPolygon, type Pt } from '../../../lib/drawingGeometry';
import { GANN_FAN_TABLE, cssColor } from '../../../lib/drawingStyle';
import { fanEnd, farPoint, ratioLabel } from '../../../lib/geometry/gann';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { boolField, opacityField, widthField } from './fields';
import { drawLevelLabel, enabledLevels } from './fibLevels';
import type { DrawingTool, ToolView } from './types';

type FanLine = { v: number; color: string; end: Pt; far: Pt };

/** The enabled lines: `end` on the box of the two points, `far` out past the pane edge. */
function lines([a, b]: Pt[], view: ToolView): FanLine[] {
  const reach = 2 * (view.width + view.height) + Math.hypot(b.x - a.x, b.y - a.y);
  const out: FanLine[] = [];
  for (const l of enabledLevels(view.style)) {
    const end = fanEnd(a, b, l.value);
    const far = end && farPoint(a, end, reach);
    if (end && far) out.push({ v: l.value, color: l.color, end, far });
  }
  return out;
}

/** Lines from point 1 at 1x8 ... 8x1 of the box the two points span (1x1 through point 2), to the pane edge. */
export const gannFan: DrawingTool = {
  id: 'gannFan',
  label: 'Gann fan',
  group: 'fib-gann',
  section: 'Gann',
  icon: (
    <Svg>
      <line x1="4" y1="20" x2="20" y2="4" />
      <line x1="4" y1="20" x2="20" y2="11" />
      <line x1="4" y1="20" x2="11" y2="4" />
      <line x1="4" y1="20" x2="20" y2="17" />
    </Svg>
  ),
  anchors: 2,
  settings: [
    { key: 'levels', label: 'Fan lines', kind: 'levels', tab: 'style', default: GANN_FAN_TABLE },
    widthField('width', 'Width', 1),
    boolField('background', 'Background', true),
    opacityField('backgroundOpacity', 'Background opacity', 0.08),
    boolField('showLabels', 'Show labels', true, 'text'),
  ],
  axisLabels: (anchors, _style, selected) => (selected ? { price: anchors.map((a) => a.price), time: anchors.map((a) => a.time) } : {}),
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const a = pts[0];
    const ls = lines(pts, view);
    if (view.style.background === true) {
      for (let i = 1; i < ls.length; i++) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(ls[i - 1].far.x, ls[i - 1].far.y);
        ctx.lineTo(ls[i].far.x, ls[i].far.y);
        ctx.closePath();
        ctx.fillStyle = cssColor(ls[i].color, view.style.backgroundOpacity as number);
        ctx.fill();
      }
    }
    ctx.lineWidth = (view.style.width as number) + (selected ? 0.5 : 0);
    for (const l of ls) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(l.far.x, l.far.y);
      ctx.strokeStyle = selected && !view.styled ? theme.accent2 : cssColor(l.color);
      ctx.stroke();
      if (view.style.showLabels === true && l.end.x >= 0 && l.end.x <= view.width && l.end.y >= 0 && l.end.y <= view.height) {
        drawLevelLabel(ctx, ratioLabel(l.v), l.end.x + 3, l.end.y - 2);
      }
    }
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 2) return false;
    const a = pts[0];
    const ls = lines(pts, view);
    if (ls.some((l) => distToSegment(p, a, l.far) <= tolerance)) return true;
    if (view.style.background !== true) return false;
    for (let i = 1; i < ls.length; i++) if (inFanPolygon(p, [a, ls[i - 1].far, ls[i].far])) return true;
    return false;
  },
  handles: (pts) => pts,
};
