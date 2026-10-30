import { HIT_TOLERANCE, type Pt } from '../../../lib/drawingGeometry';
import { curvePoints, defaultCurveControl, defaultDoubleCurveControls, polylineHit } from '../../../lib/geometry/shapes';
import { Svg } from '../../DrawingIcons';
import { anchorLabels, tracePath } from './closedShape';
import { applyDash, boolField, colorField, lineStyleField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import { arrowHead } from './lineTool';
import type { DrawingTool } from './types';
import type { ReactNode } from 'react';

/** The first point of the curve at a visible distance from `from`, so a head points the way the curve leaves its end. */
const away = (samples: readonly Pt[], from: Pt, reverse: boolean): Pt => {
  const list = reverse ? [...samples].reverse() : samples;
  return list.find((q) => Math.hypot(q.x - from.x, q.y - from.y) > 1) ?? list[list.length - 1];
};

/**
 * A curve from a start to an end point bent by its control points. The user places the start and end; the control
 * points are added when the end is placed and dragged by their handles afterwards.
 */
function curveTool(id: string, label: string, controls: 1 | 2, icon: ReactNode): DrawingTool {
  return {
    id,
    label,
    group: 'shapes',
    section: 'Shapes',
    icon,
    anchors: 2 + controls,
    placed: 2,
    settings: [
      colorField('color', 'Colour', 'accent'),
      opacityField('opacity', 'Opacity', 1),
      widthField('width', 'Width', 1.5),
      lineStyleField('lineStyle', 'Line style'),
      boolField('arrowStart', 'Arrow at start', false),
      boolField('arrowEnd', 'Arrow at end', false),
    ],
    axisLabels: anchorLabels,
    draw(ctx, pts, view, { selected }) {
      if (pts.length < 2) return;
      const line = curvePoints(pts);
      const color = strokeColor(view, selected);
      tracePath(ctx, line, false);
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeWidth(view, selected);
      ctx.lineJoin = 'round';
      applyDash(ctx, view.style.lineStyle);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      const head = 6 + (view.style.width as number) * 2;
      if (view.style.arrowEnd === true) arrowHead(ctx, line[line.length - 1], away(line, line[line.length - 1], true), head);
      if (view.style.arrowStart === true) arrowHead(ctx, line[0], away(line, line[0], false), head);
    },
    hit: (pts, p, _view, tolerance = HIT_TOLERANCE) => polylineHit(curvePoints(pts), p, false, tolerance),
    handles: (pts) => pts,
    /** The control points a new curve starts with: a bend to one side (an S for two). */
    settle: (pts) => (pts.length !== 2 ? pts : controls === 1 ? [...pts, defaultCurveControl(pts[0], pts[1])] : [...pts, ...defaultDoubleCurveControls(pts[0], pts[1])]),
  };
}

export const curve: DrawingTool = curveTool(
  'curve',
  'Curve',
  1,
  <Svg>
    <path d="M4 18Q12 0 20 18" />
  </Svg>,
);

export const doubleCurve: DrawingTool = curveTool(
  'doubleCurve',
  'Double curve',
  2,
  <Svg>
    <path d="M4 18C10 18 8 6 14 6S18 12 20 6" />
  </Svg>,
);
