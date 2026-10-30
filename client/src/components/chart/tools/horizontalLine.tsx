import { HANDLE_RADIUS, HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { applyDash, boolField, colorField, lineStyleField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool } from './types';

export const horizontalLine: DrawingTool = {
  id: 'horizontalLine',
  label: 'Horizontal line',
  group: 'lines',
  section: 'Lines',
  icon: (
    <Svg>
      <line x1="3" y1="12" x2="21" y2="12" />
      <circle cx="12" cy="12" r="2" />
    </Svg>
  ),
  anchors: 1,
  priceOnly: true,
  settings: [
    colorField('color', 'Colour', 'amber'),
    opacityField('opacity', 'Opacity', 0.85),
    widthField('width', 'Width', 1.5),
    lineStyleField('lineStyle', 'Line style'),
    boolField('showLabel', 'Price label on the axis', true),
    colorField('labelColor', 'Label colour', 'amber'),
  ],
  draw(ctx, [a], view, { selected }) {
    ctx.beginPath();
    ctx.moveTo(0, a.y);
    ctx.lineTo(view.width, a.y);
    ctx.strokeStyle = strokeColor(view, selected, theme.amber);
    ctx.lineWidth = strokeWidth(view, selected);
    applyDash(ctx, view.style.lineStyle);
    ctx.stroke();
  },
  hit: ([a], p, _view, tolerance = HIT_TOLERANCE) => Math.abs(p.y - a.y) <= tolerance,
  // The line spans the width, so the handle stays on screen even when its anchor time is off it.
  handles: ([a], { width }) => [{ x: Math.min(Math.max(a.x, HANDLE_RADIUS + 2), width - HANDLE_RADIUS - 2), y: a.y }],
};
