import { HIT_TOLERANCE, distToSegment, inTriangle, type Pt } from '../../../lib/drawingGeometry';
import { FIB_SPEED_TABLE, cssColor } from '../../../lib/drawingStyle';
import { fanValue } from '../../../lib/geometry/fib';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { boolField, opacityField, widthField } from './fields';
import { drawLevelLabel, enabledLevels } from './fibLevels';
import type { DrawingTool, ToolView } from './types';

/** One fan line: from point 1 to `end`; a price line ends on the vertical edge through point 2, a time line on the horizontal one. */
type Fan = { ratio: number; end: Pt; color: string };
type Layout = { price: Fan[]; time: Fan[] };

function layout(pts: Pt[], view: ToolView): Layout {
  if (pts.length < 2) return { price: [], time: [] };
  const [a, b] = pts;
  const reverse = view.style.reverse === true;
  const price = enabledLevels(view.style, 'priceLevels').map((l) => ({ ratio: l.value, color: l.color, end: { x: b.x, y: fanValue(a.y, b.y, l.value, reverse) } }));
  const time = enabledLevels(view.style, 'timeLevels').map((l) => ({ ratio: l.value, color: l.color, end: { x: fanValue(a.x, b.x, l.value, reverse), y: b.y } }));
  return { price, time };
}

/** Fan lines from point 1 through the price and time levels of the box that point 1 and point 2 span. */
export const fibSpeedFan: DrawingTool = {
  id: 'fibSpeedFan',
  label: 'Fib speed resistance fan',
  group: 'fib-gann',
  section: 'Fibonacci',
  icon: (
    <Svg>
      <line x1="4" y1="20" x2="20" y2="5" />
      <line x1="4" y1="20" x2="20" y2="11" />
      <line x1="4" y1="20" x2="20" y2="16" />
      <line x1="4" y1="20" x2="12" y2="4" />
    </Svg>
  ),
  anchors: 2,
  settings: [
    { key: 'priceLevels', label: 'Price levels', kind: 'levels', tab: 'style', default: FIB_SPEED_TABLE },
    { key: 'timeLevels', label: 'Time levels', kind: 'levels', tab: 'style', default: FIB_SPEED_TABLE },
    widthField('width', 'Width', 1),
    boolField('showGrid', 'Grid', true),
    boolField('background', 'Background', true),
    opacityField('backgroundOpacity', 'Background opacity', 0.08),
    boolField('reverse', 'Reverse', false),
    boolField('labelsLeft', 'Left labels', true, 'text'),
    boolField('labelsRight', 'Right labels', true, 'text'),
    boolField('labelsTop', 'Top labels', true, 'text'),
    boolField('labelsBottom', 'Bottom labels', true, 'text'),
  ],
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const [a, b] = pts;
    const { price, time } = layout(pts, view);
    const style = view.style;
    if (style.background === true) {
      for (const set of [price, time]) {
        for (let i = 1; i < set.length; i++) {
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(set[i - 1].end.x, set[i - 1].end.y);
          ctx.lineTo(set[i].end.x, set[i].end.y);
          ctx.closePath();
          ctx.fillStyle = cssColor(set[i].color, style.backgroundOpacity as number);
          ctx.fill();
        }
      }
    }
    ctx.lineWidth = (style.width as number) + (selected ? 0.5 : 0);
    const stroke = (color: string) => (selected && !view.styled ? theme.accent2 : cssColor(color));
    if (style.showGrid === true) {
      ctx.save();
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 3]);
      for (const f of price) {
        ctx.beginPath();
        ctx.moveTo(a.x, f.end.y);
        ctx.lineTo(b.x, f.end.y);
        ctx.strokeStyle = cssColor(f.color, 0.5);
        ctx.stroke();
      }
      for (const f of time) {
        ctx.beginPath();
        ctx.moveTo(f.end.x, a.y);
        ctx.lineTo(f.end.x, b.y);
        ctx.strokeStyle = cssColor(f.color, 0.5);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const f of [...price, ...time]) {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(f.end.x, f.end.y);
      ctx.strokeStyle = stroke(f.color);
      ctx.stroke();
    }
    const left = Math.min(a.x, b.x);
    const right = Math.max(a.x, b.x);
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y, b.y);
    const inside = (x: number, y: number) => x >= 0 && x <= view.width && y >= 0 && y <= view.height;
    for (const f of price) {
      if (style.labelsLeft === true && inside(left, f.end.y)) drawLevelLabel(ctx, `${f.ratio}`, left - 3, f.end.y, 'right', 'middle');
      if (style.labelsRight === true && inside(right, f.end.y)) drawLevelLabel(ctx, `${f.ratio}`, right + 3, f.end.y, 'left', 'middle');
    }
    for (const f of time) {
      if (style.labelsTop === true && inside(f.end.x, top)) drawLevelLabel(ctx, `${f.ratio}`, f.end.x, top - 3, 'center', 'bottom');
      if (style.labelsBottom === true && inside(f.end.x, bottom)) drawLevelLabel(ctx, `${f.ratio}`, f.end.x, bottom + 3, 'center', 'top');
    }
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 2) return false;
    const [a, b] = pts;
    const { price, time } = layout(pts, view);
    if (view.style.showGrid === true) {
      if (price.some((f) => distToSegment(p, { x: a.x, y: f.end.y }, { x: b.x, y: f.end.y }) <= tolerance)) return true;
      if (time.some((f) => distToSegment(p, { x: f.end.x, y: a.y }, { x: f.end.x, y: b.y }) <= tolerance)) return true;
    }
    if ([...price, ...time].some((f) => distToSegment(p, a, f.end) <= tolerance)) return true;
    if (view.style.background !== true) return false;
    for (const set of [price, time]) {
      for (let i = 1; i < set.length; i++) if (inTriangle(p, a, set[i - 1].end, set[i].end)) return true;
    }
    return false;
  },
  handles: (pts) => pts,
};
