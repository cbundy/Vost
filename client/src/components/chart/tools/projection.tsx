import { HIT_TOLERANCE, distToSegment } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { distToProjectionArc, inProjectionWedge, projectionGeometry, projectionWedge } from '../../../lib/geometry/forecast';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { colorField, numberField, opacityField, strokeColor, widthField } from './fields';
import { drawLabel } from './positionTool';
import type { DrawingTool } from './types';

const finiteAnchors = (anchors: readonly { time: number; price: number }[]) => anchors.every((a) => Number.isFinite(a.time) && Number.isFinite(a.price));

/**
 * A Projection: a leg from point 1 to point 2 and a projection from point 1 to point 3. An arc around point 1, as far
 * from it as the leg is long, spans the angle between them; the wedge is filled and a label gives the projection's
 * length as a percent of the leg's.
 */
export const projection: DrawingTool = {
  id: 'projection',
  label: 'Projection',
  group: 'forecast-measure',
  section: 'Forecasting',
  icon: (
    <Svg>
      <path d="M4 19h14M4 19 16 7" />
      <path d="M12 19a8 8 0 0 0-2.4-5.7" />
    </Svg>
  ),
  anchors: 3,
  settings: [
    colorField('color', 'Line colour', 'accent'),
    widthField('width', 'Line width', 1),
    colorField('fillColor', 'Fill colour', 'accent'),
    opacityField('fillOpacity', 'Fill opacity', 0.2),
    colorField('textColor', 'Text colour', 'text'),
    numberField('textSize', 'Font size', 12, 8, 48, 1),
  ],
  validate: (d) => (d.anchors.length === 3 && finiteAnchors(d.anchors) ? d : null),
  axisLabels: (anchors, _style, selected) => (selected && anchors.length >= 3 ? { price: anchors.map((a) => a.price), time: anchors.map((a) => a.time) } : {}),
  draw(ctx, pts, view, { selected }) {
    if (pts.length < 2) return;
    const [a, b, c] = pts;
    const line = strokeColor(view, selected, theme.accent2, 'color', null);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, view.width, view.height);
    ctx.clip();
    ctx.lineWidth = (view.style.width as number) + (selected ? 0.5 : 0);
    ctx.strokeStyle = line;
    const g = c ? projectionGeometry(a, b, c) : null;
    if (c && g) {
      const wedge = projectionWedge(a, g);
      ctx.beginPath();
      wedge.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fillStyle = cssColor(view.style.fillColor, view.style.fillOpacity as number);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(a.x, a.y, g.radius, g.legAngle, g.legAngle + g.sweep, g.sweep < 0);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    if (c) {
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(c.x, c.y);
    }
    ctx.stroke();
    if (c && g) {
      const mid = g.legAngle + g.sweep / 2;
      drawLabel(ctx, [`${g.percent.toFixed(2)}%`], a.x + Math.cos(mid) * g.radius, a.y + Math.sin(mid) * g.radius, Math.sin(mid) < 0, line, view);
    }
    ctx.restore();
  },
  hit(pts, p, _view, tolerance = HIT_TOLERANCE) {
    const [a, b, c] = pts;
    if (!a || !b) return false;
    if (distToSegment(p, a, b) <= tolerance) return true;
    if (!c) return false;
    if (distToSegment(p, a, c) <= tolerance) return true;
    const g = projectionGeometry(a, b, c);
    return !!g && (distToProjectionArc(p, a, g) <= tolerance || inProjectionWedge(p, a, g));
  },
  handles: (pts) => pts,
};
