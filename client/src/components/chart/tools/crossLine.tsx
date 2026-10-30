import { HANDLE_RADIUS, HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { Svg } from '../../DrawingIcons';
import { applyDash, colorField, lineStyleField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool } from './types';

/** One anchor and a full-width plus a full-height line; it moves in time and price. */
export const crossLine: DrawingTool = {
  id: 'crossLine',
  label: 'Cross line',
  group: 'lines',
  section: 'Lines',
  icon: (
    <Svg>
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <circle cx="12" cy="12" r="2" />
    </Svg>
  ),
  anchors: 1,
  fullWidth: true,
  fullHeight: true,
  settings: [colorField('color', 'Colour', 'accent'), opacityField('opacity', 'Opacity', 1), widthField('width', 'Width', 1.5), lineStyleField('lineStyle', 'Line style')],
  axisLabels: (anchors, _style, selected) => (selected ? { price: [anchors[0].price], time: [anchors[0].time] } : {}),
  draw(ctx, [a], view, { selected }) {
    ctx.beginPath();
    ctx.moveTo(a.x, 0);
    ctx.lineTo(a.x, view.height);
    ctx.moveTo(0, a.y);
    ctx.lineTo(view.width, a.y);
    ctx.strokeStyle = strokeColor(view, selected);
    ctx.lineWidth = strokeWidth(view, selected);
    applyDash(ctx, view.style.lineStyle);
    ctx.stroke();
  },
  hit: ([a], p, _view, tolerance = HIT_TOLERANCE) => Math.abs(p.x - a.x) <= tolerance || Math.abs(p.y - a.y) <= tolerance,
  handles: ([a], { width, height }) => [
    { x: Math.min(Math.max(a.x, HANDLE_RADIUS + 2), width - HANDLE_RADIUS - 2), y: Math.min(Math.max(a.y, HANDLE_RADIUS + 2), height - HANDLE_RADIUS - 2) },
  ],
};
