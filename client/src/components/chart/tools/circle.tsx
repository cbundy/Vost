import { HIT_TOLERANCE, type Pt } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { circleHit, circleRadius } from '../../../lib/geometry/shapes';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { applyDash, colorField, lineStyleField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool } from './types';

/** A circle from its centre (the first anchor) to a point on its edge (the second); the radius is in pixels, so it stays round at any zoom. */
export const circle: DrawingTool = {
  id: 'circle',
  label: 'Circle',
  group: 'shapes',
  section: 'Shapes',
  icon: (
    <Svg>
      <circle cx="12" cy="12" r="7" />
    </Svg>
  ),
  anchors: 2,
  settings: [
    colorField('color', 'Border colour', 'accent'),
    widthField('width', 'Border width', 1.5),
    lineStyleField('lineStyle', 'Border style'),
    colorField('fillColor', 'Fill colour', 'accent'),
    opacityField('fillOpacity', 'Fill opacity', 0.15),
  ],
  draw(ctx, [c, e], view, { selected }) {
    const r = circleRadius(c, e);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fillStyle = cssColor(view.style.fillColor, view.style.fillOpacity as number);
    ctx.fill();
    ctx.strokeStyle = strokeColor(view, selected, theme.accent2, 'color', null);
    ctx.lineWidth = strokeWidth(view, selected);
    applyDash(ctx, view.style.lineStyle);
    ctx.stroke();
    ctx.setLineDash([]);
  },
  hit([c, e], p, view, tolerance = HIT_TOLERANCE) {
    return circleHit(c, e, p, (view.style.fillOpacity as number) > 0, tolerance);
  },
  handles: ([c, e]) => [c, e],
  dragHandle(orig: Pt[], handle: number, p: Pt) {
    if (handle === 0) return [p, { x: orig[1].x + (p.x - orig[0].x), y: orig[1].y + (p.y - orig[0].y) }];
    return [orig[0], p];
  },
};
