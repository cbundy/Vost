import { HIT_TOLERANCE, type Pt } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { smoothPath, strokeHit } from '../../../lib/geometry/freehand';
import { pointInPolygon } from '../../../lib/geometry/shapes';
import { Svg } from '../../DrawingIcons';
import { boolField, colorField, numberField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { DrawingTool } from './types';

/** The most points a stored freehand stroke has; a longer stroke is thinned harder. */
export const FREEHAND_MAX_POINTS = 200;
/** The ends of a brush stroke this close (pixels) count as closed, so the fill shows. */
const CLOSE_PX = 10;

const closed = (pts: Pt[]) => pts.length > 2 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) <= CLOSE_PX;

function trace(ctx: CanvasRenderingContext2D, pts: Pt[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
}

/** A freehand stroke: the stored points are the thinned samples, smoothed only when drawn. */
export const brush: DrawingTool = {
  id: 'brush',
  label: 'Brush',
  group: 'shapes',
  section: 'Brushes',
  icon: (
    <Svg>
      <path d="M4 18 C7 10 10 20 13 12 S18 6 20 5" />
    </Svg>
  ),
  anchors: { min: 2, max: FREEHAND_MAX_POINTS },
  freehand: true,
  settings: [
    colorField('color', 'Colour', 'accent'),
    opacityField('opacity', 'Opacity', 1),
    widthField('width', 'Width', 2),
    numberField('smoothing', 'Smoothing', 5, 0, 20, 1),
    boolField('fill', 'Fill when closed', false),
    colorField('fillColor', 'Fill colour', 'accent'),
    opacityField('fillOpacity', 'Fill opacity', 0.2),
  ],
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const line = smoothPath(pts, view.style.smoothing as number);
    if (view.style.fill === true && closed(pts)) {
      trace(ctx, line);
      ctx.closePath();
      ctx.fillStyle = cssColor(view.style.fillColor, view.style.fillOpacity as number);
      ctx.fill();
    }
    trace(ctx, line);
    ctx.strokeStyle = strokeColor(view, selected);
    ctx.lineWidth = strokeWidth(view, selected);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (strokeHit(pts, p, (view.style.width as number) / 2, tolerance)) return true;
    return view.style.fill === true && closed(pts) && pointInPolygon(p, pts);
  },
  handles: () => [],
};

/** A wide translucent freehand stroke with round caps and joins. */
export const highlighter: DrawingTool = {
  id: 'highlighter',
  label: 'Highlighter',
  group: 'shapes',
  section: 'Brushes',
  icon: (
    <Svg>
      <path d="M5 19 L9 19 L19 9 L15 5 L5 15 Z" />
      <path d="M13 7 L17 11" />
    </Svg>
  ),
  anchors: { min: 2, max: FREEHAND_MAX_POINTS },
  freehand: true,
  settings: [colorField('color', 'Colour', '#ffeb3b'), opacityField('opacity', 'Opacity', 0.35), widthField('width', 'Width', 20, 5, 40)],
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    trace(ctx, pts);
    ctx.strokeStyle = strokeColor(view, selected);
    ctx.lineWidth = strokeWidth(view, selected);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  },
  hit: (pts, p, view, tolerance = HIT_TOLERANCE) => strokeHit(pts, p, (view.style.width as number) / 2, tolerance),
  handles: () => [],
};
