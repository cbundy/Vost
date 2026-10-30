import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { distToSpiral, spiralPoints } from '../../../lib/geometry/fib';
import { Svg } from '../../DrawingIcons';
import { applyDash, boolField, colorField, lineStyleField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool } from './types';

/** A golden spiral around point 1 that passes through point 2. */
export const fibSpiral: DrawingTool = {
  id: 'fibSpiral',
  label: 'Fib spiral',
  group: 'fib-gann',
  section: 'Fibonacci',
  icon: (
    <Svg>
      <path d="M12 12c0-1 1.5-1 1.5 0s-2 1.5-2.5 0 .5-3.5 3.5-3.5 5 3 5 6-3 6.5-7.5 6.5S3 14 3 9" />
    </Svg>
  ),
  anchors: 2,
  settings: [
    colorField('color', 'Colour', 'accent'),
    opacityField('opacity', 'Opacity', 1),
    widthField('width', 'Width', 1.5),
    lineStyleField('lineStyle', 'Line style'),
    boolField('counterClockwise', 'Counter-clockwise', false),
  ],
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const [a, b] = pts;
    const reach = Math.hypot(Math.max(a.x, view.width - a.x), Math.max(a.y, view.height - a.y));
    const path = spiralPoints(a, b, view.style.counterClockwise === true, reach);
    if (path.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.strokeStyle = strokeColor(view, selected);
    ctx.lineWidth = strokeWidth(view, selected);
    ctx.save();
    applyDash(ctx, view.style.lineStyle);
    ctx.stroke();
    ctx.restore();
  },
  hit: (pts, p, view, tolerance = HIT_TOLERANCE) => pts.length >= 2 && distToSpiral(p, pts[0], pts[1], view.style.counterClockwise === true) <= tolerance,
  handles: (pts) => pts,
};
