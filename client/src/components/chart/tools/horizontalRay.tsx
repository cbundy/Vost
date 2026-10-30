import { HANDLE_RADIUS, HIT_TOLERANCE, distToSegment } from '../../../lib/drawingGeometry';
import { Svg } from '../../DrawingIcons';
import { applyDash, colorField, lineStyleField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool } from './types';

/** One anchor and a line from it to the right edge of the pane; it moves in time and price. */
export const horizontalRay: DrawingTool = {
  id: 'horizontalRay',
  label: 'Horizontal ray',
  group: 'lines',
  section: 'Lines',
  icon: (
    <Svg>
      <circle cx="5" cy="12" r="2" />
      <line x1="7" y1="12" x2="21" y2="12" />
      <polyline points="17,8 21,12 17,16" />
    </Svg>
  ),
  anchors: 1,
  settings: [colorField('color', 'Colour', 'accent'), opacityField('opacity', 'Opacity', 1), widthField('width', 'Width', 1.5), lineStyleField('lineStyle', 'Line style')],
  axisLabels: (anchors, _style, selected) => (selected ? { price: [anchors[0].price], time: [anchors[0].time] } : {}),
  draw(ctx, [a], view, { selected }) {
    if (a.x > view.width) return;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(view.width, a.y);
    ctx.strokeStyle = strokeColor(view, selected);
    ctx.lineWidth = strokeWidth(view, selected);
    applyDash(ctx, view.style.lineStyle);
    ctx.stroke();
  },
  hit: ([a], p, view, tolerance = HIT_TOLERANCE) => a.x <= view.width && distToSegment(p, a, { x: view.width, y: a.y }) <= tolerance,
  handles: ([a], { width }) => [{ x: Math.min(Math.max(a.x, HANDLE_RADIUS + 2), width - HANDLE_RADIUS - 2), y: a.y }],
};
