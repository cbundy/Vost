import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { Svg } from '../../DrawingIcons';
import { applyDash, colorField, lineStyleField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool } from './types';

/** One anchor and a full-height line; a drag keeps its price, so it works with the price scrolled away. */
export const verticalLine: DrawingTool = {
  id: 'verticalLine',
  label: 'Vertical line',
  group: 'lines',
  section: 'Lines',
  icon: (
    <Svg>
      <line x1="12" y1="3" x2="12" y2="21" />
      <circle cx="12" cy="12" r="2" />
    </Svg>
  ),
  anchors: 1,
  timeOnly: true,
  fullHeight: true,
  settings: [colorField('color', 'Colour', 'accent'), opacityField('opacity', 'Opacity', 1), widthField('width', 'Width', 1.5), lineStyleField('lineStyle', 'Line style')],
  axisLabels: (anchors, _style, selected) => (selected ? { time: [anchors[0].time] } : {}),
  draw(ctx, [a], view, { selected }) {
    ctx.beginPath();
    ctx.moveTo(a.x, 0);
    ctx.lineTo(a.x, view.height);
    ctx.strokeStyle = strokeColor(view, selected);
    ctx.lineWidth = strokeWidth(view, selected);
    applyDash(ctx, view.style.lineStyle);
    ctx.stroke();
  },
  hit: ([a], p, _view, tolerance = HIT_TOLERANCE) => Math.abs(p.x - a.x) <= tolerance,
  // The handle sits mid-height: the anchor's own price is not what the line is about.
  handles: ([a], { height }) => [{ x: a.x, y: height / 2 }],
};
