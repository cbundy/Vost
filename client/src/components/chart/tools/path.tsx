import { HIT_TOLERANCE, type Pt } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { pointInPolygon, polylineHit } from '../../../lib/geometry/shapes';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { applyDash, boolField, colorField, lineStyleField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import { arrowHead } from './lineTool';
import type { DrawingTool } from './types';

/** The most points a path or a polyline takes; reaching it ends placement. */
export const PATH_MAX_POINTS = 100;

function trace(ctx: CanvasRenderingContext2D, pts: Pt[], closed: boolean): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  if (closed && pts.length > 2) ctx.closePath();
}

const axisLabels: DrawingTool['axisLabels'] = (anchors, _style, selected) => {
  if (!selected || anchors.length === 0) return {};
  return { price: anchors.map((a) => a.price), time: [anchors[0].time, anchors[anchors.length - 1].time] };
};

/** An open line through any number of points (two to {@link PATH_MAX_POINTS}), with an optional arrow at either end. */
export const path: DrawingTool = {
  id: 'path',
  label: 'Path',
  group: 'shapes',
  section: 'Shapes',
  icon: (
    <Svg>
      <polyline points="4,17 9,8 14,15 20,6" />
    </Svg>
  ),
  anchors: { min: 2, max: PATH_MAX_POINTS },
  settings: [
    colorField('color', 'Colour', 'accent'),
    opacityField('opacity', 'Opacity', 1),
    widthField('width', 'Width', 1.5),
    lineStyleField('lineStyle', 'Line style'),
    boolField('arrowStart', 'Arrow at start', false),
    boolField('arrowEnd', 'Arrow at end', false),
  ],
  axisLabels,
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const color = strokeColor(view, selected);
    trace(ctx, pts, false);
    ctx.strokeStyle = color;
    ctx.lineWidth = strokeWidth(view, selected);
    ctx.lineJoin = 'round';
    applyDash(ctx, view.style.lineStyle);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    const head = 6 + (view.style.width as number) * 2;
    const n = pts.length;
    if (view.style.arrowEnd === true) arrowHead(ctx, pts[n - 1], pts[n - 2], head);
    if (view.style.arrowStart === true) arrowHead(ctx, pts[0], pts[1], head);
  },
  hit: (pts, p, _view, tolerance = HIT_TOLERANCE) => polylineHit(pts, p, false, tolerance),
  handles: (pts) => pts,
};

/** A closed shape through any number of points (three to {@link PATH_MAX_POINTS}), with a border and a fill. */
export const polyline: DrawingTool = {
  id: 'polyline',
  label: 'Polyline',
  group: 'shapes',
  section: 'Shapes',
  icon: (
    <Svg>
      <polygon points="5,17 7,7 14,5 19,12 15,18" />
    </Svg>
  ),
  anchors: { min: 3, max: PATH_MAX_POINTS },
  settings: [
    colorField('color', 'Border colour', 'accent'),
    widthField('width', 'Border width', 1.5),
    lineStyleField('lineStyle', 'Border style'),
    colorField('fillColor', 'Fill colour', 'accent'),
    opacityField('fillOpacity', 'Fill opacity', 0.15),
  ],
  axisLabels,
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    trace(ctx, pts, true);
    if (pts.length > 2) {
      ctx.fillStyle = cssColor(view.style.fillColor, view.style.fillOpacity as number);
      ctx.fill();
    }
    ctx.strokeStyle = strokeColor(view, selected, theme.accent2, 'color', null);
    ctx.lineWidth = strokeWidth(view, selected);
    ctx.lineJoin = 'round';
    applyDash(ctx, view.style.lineStyle);
    ctx.stroke();
    ctx.setLineDash([]);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    if (polylineHit(pts, p, true, tolerance)) return true;
    return (view.style.fillOpacity as number) > 0 && pointInPolygon(p, pts);
  },
  handles: (pts) => pts,
};
