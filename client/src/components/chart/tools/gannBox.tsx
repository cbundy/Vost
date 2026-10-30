import { HIT_TOLERANCE, distToSegment, rectCornerDrag, rectCorners, type Pt } from '../../../lib/drawingGeometry';
import { GANN_BOX_TABLE, cssColor } from '../../../lib/drawingStyle';
import { boxCoord } from '../../../lib/geometry/gann';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { boolField, opacityField, widthField } from './fields';
import { enabledLevels, labelPlacer } from './fibLevels';
import type { DrawingTool, ToolView } from './types';

type Line = { ratio: number; at: number; color: string };

/** The box's edges and its enabled price (horizontal) and time (vertical) lines. */
function layout([a, b]: Pt[], view: ToolView) {
  const reverse = view.style.reverse === true;
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const price: Line[] = enabledLevels(view.style, 'priceLevels').map((l) => ({ ratio: l.value, color: l.color, at: boxCoord(y1, y0, l.value, reverse) }));
  const time: Line[] = enabledLevels(view.style, 'timeLevels').map((l) => ({ ratio: l.value, color: l.color, at: boxCoord(x0, x1, l.value, reverse) }));
  return { x0, x1, y0, y1, price, time };
}

/** Two points are opposite corners of a box with price and time levels, optional diagonals and a fill per band. */
export const gannBox: DrawingTool = {
  id: 'gannBox',
  label: 'Gann box',
  group: 'fib-gann',
  section: 'Gann',
  icon: (
    <Svg>
      <rect x="4" y="5" width="16" height="14" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="4" y1="19" x2="20" y2="5" />
    </Svg>
  ),
  anchors: 2,
  settings: [
    { key: 'priceLevels', label: 'Price levels', kind: 'levels', tab: 'style', default: GANN_BOX_TABLE },
    { key: 'timeLevels', label: 'Time levels', kind: 'levels', tab: 'style', default: GANN_BOX_TABLE },
    widthField('width', 'Width', 1),
    boolField('angles', 'Angles', true),
    boolField('background', 'Background', true),
    opacityField('backgroundOpacity', 'Background opacity', 0.08),
    boolField('reverse', 'Reverse', false),
    boolField('labelsLeft', 'Left labels', true, 'text'),
    boolField('labelsRight', 'Right labels', true, 'text'),
    boolField('labelsTop', 'Top labels', true, 'text'),
    boolField('labelsBottom', 'Bottom labels', true, 'text'),
  ],
  axisLabels: (anchors, _style, selected) => (selected ? { price: anchors.map((a) => a.price), time: anchors.map((a) => a.time) } : {}),
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const { x0, x1, y0, y1, price, time } = layout(pts, view);
    const style = view.style;
    if (style.background === true) {
      for (let i = 1; i < price.length; i++) {
        ctx.fillStyle = cssColor(price[i].color, style.backgroundOpacity as number);
        ctx.fillRect(x0, Math.min(price[i - 1].at, price[i].at), x1 - x0, Math.abs(price[i].at - price[i - 1].at));
      }
      for (let i = 1; i < time.length; i++) {
        ctx.fillStyle = cssColor(time[i].color, style.backgroundOpacity as number);
        ctx.fillRect(Math.min(time[i - 1].at, time[i].at), y0, Math.abs(time[i].at - time[i - 1].at), y1 - y0);
      }
    }
    ctx.lineWidth = (style.width as number) + (selected ? 0.5 : 0);
    const stroke = (color: string) => (selected && !view.styled ? theme.accent2 : cssColor(color));
    for (const l of price) {
      ctx.beginPath();
      ctx.moveTo(x0, l.at);
      ctx.lineTo(x1, l.at);
      ctx.strokeStyle = stroke(l.color);
      ctx.stroke();
    }
    for (const l of time) {
      ctx.beginPath();
      ctx.moveTo(l.at, y0);
      ctx.lineTo(l.at, y1);
      ctx.strokeStyle = stroke(l.color);
      ctx.stroke();
    }
    if (style.angles === true) {
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.moveTo(x1, y0);
      ctx.lineTo(x0, y1);
      ctx.strokeStyle = stroke('accent');
      ctx.stroke();
    }
    const put = labelPlacer(ctx, view.width, view.height);
    for (const l of price) {
      if (style.labelsLeft === true) put(`${l.ratio}`, x0 - 3, l.at, 'right', 'middle');
      if (style.labelsRight === true) put(`${l.ratio}`, x1 + 3, l.at, 'left', 'middle');
    }
    for (const l of time) {
      if (style.labelsTop === true) put(`${l.ratio}`, l.at, y0 - 3, 'center', 'bottom');
      if (style.labelsBottom === true) put(`${l.ratio}`, l.at, y1 + 3, 'center', 'top');
    }
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (pts.length < 2) return false;
    const { x0, x1, y0, y1, price, time } = layout(pts, view);
    if (price.some((l) => distToSegment(p, { x: x0, y: l.at }, { x: x1, y: l.at }) <= tolerance)) return true;
    if (time.some((l) => distToSegment(p, { x: l.at, y: y0 }, { x: l.at, y: y1 }) <= tolerance)) return true;
    if (view.style.angles === true && (distToSegment(p, { x: x0, y: y0 }, { x: x1, y: y1 }) <= tolerance || distToSegment(p, { x: x1, y: y0 }, { x: x0, y: y1 }) <= tolerance)) return true;
    if (view.style.background !== true) return false;
    const band = (set: Line[], v: number) => set.some((l, i) => i > 0 && v >= Math.min(set[i - 1].at, l.at) && v <= Math.max(set[i - 1].at, l.at));
    return (p.x >= x0 && p.x <= x1 && band(price, p.y)) || (p.y >= y0 && p.y <= y1 && band(time, p.x));
  },
  /** The four corners, then the midpoints of the top, right, bottom and left sides. */
  handles(pts) {
    if (pts.length < 2) return pts;
    const [a, b] = pts;
    const [tl, tr, br, bl] = rectCorners(a, b);
    return [tl, tr, br, bl, { x: (tl.x + tr.x) / 2, y: tl.y }, { x: tr.x, y: (tr.y + br.y) / 2 }, { x: (bl.x + br.x) / 2, y: br.y }, { x: tl.x, y: (tl.y + bl.y) / 2 }];
  },
  /** A corner keeps the opposite one; a side handle moves only that side. */
  dragHandle(pts, handle, p) {
    if (pts.length < 2) return pts;
    const [a, b] = pts;
    if (handle < 4) return rectCornerDrag(a, b, handle, p);
    let [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
    if (handle === 4) y0 = p.y;
    else if (handle === 5) x1 = p.x;
    else if (handle === 6) y1 = p.y;
    else x0 = p.x;
    return [{ x: x0, y: y0 }, { x: x1, y: y1 }];
  },
};
