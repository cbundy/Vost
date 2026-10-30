import { HIT_TOLERANCE, pointInRect, rectCornerDrag, rectCorners, type Pt } from '../../../lib/drawingGeometry';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { cssColor } from '../../../lib/drawingStyle';
import { applyDash, boolField, colorField, lineStyleField, opacityField, strokeColor, strokeWidth, widthField } from './fields';
import type { ToolView } from './types';
import type { DrawingTool } from './types';

/** The rectangle's corners as drawn: its horizontal extent runs to the pane edge on an extended side. */
function bounds([a, b]: Pt[], view: ToolView): [Pt, Pt] {
  const [tl, , br] = rectCorners(a, b);
  return [{ x: view.style.extendLeft === true ? 0 : tl.x, y: tl.y }, { x: view.style.extendRight === true ? view.width : br.x, y: br.y }];
}

export const rectangle: DrawingTool = {
  id: 'rectangle',
  label: 'Rectangle',
  icon: (
    <Svg>
      <rect x="4" y="6" width="16" height="12" rx="1" />
    </Svg>
  ),
  anchors: 2,
  settings: [
    colorField('color', 'Border colour', 'accent'),
    widthField('width', 'Border width', 1.5),
    lineStyleField('lineStyle', 'Border style'),
    colorField('fillColor', 'Fill colour', 'accent'),
    opacityField('fillOpacity', 'Fill opacity', 0.15),
    boolField('extendLeft', 'Extend left', false),
    boolField('extendRight', 'Extend right', false),
  ],
  draw(ctx, pts, view, { selected }) {
    const [tl, br] = bounds(pts, view);
    ctx.fillStyle = cssColor(view.style.fillColor, view.style.fillOpacity as number);
    ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    ctx.strokeStyle = strokeColor(view, selected, theme.accent2, 'color', null);
    ctx.lineWidth = strokeWidth(view, selected);
    applyDash(ctx, view.style.lineStyle);
    ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  },
  hit(pts, p, view, tolerance = HIT_TOLERANCE) {
    const [a, b] = bounds(pts, view);
    return pointInRect(p, a, b, tolerance);
  },
  handles: ([a, b]) => rectCorners(a, b),
  dragHandle(origPts: Pt[], handle: number, p: Pt) {
    return rectCornerDrag(origPts[0], origPts[1], handle, p);
  },
};
