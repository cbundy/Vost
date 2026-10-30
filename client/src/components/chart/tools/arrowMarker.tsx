import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { arrowMarkerLabelRect, arrowMarkerOutline, inRect, pointInPolygon } from '../../../lib/geometry/shapes';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { captionBox, captionSettings, drawCaption } from './captionLabel';
import { colorField } from './fields';
import type { DrawingTool } from './types';

/** A filled arrow from its tail (first anchor) to its tip (second), with an optional label at the tail. */
export const arrowMarker: DrawingTool = {
  id: 'arrowMarker',
  label: 'Arrow marker',
  group: 'shapes',
  section: 'Shapes',
  icon: (
    <Svg>
      <path d="M4 20l8-8M12 12V6l8 -2 -2 8h-6z" />
    </Svg>
  ),
  anchors: 2,
  caption: true,
  settings: [colorField('color', 'Colour', 'accent'), ...captionSettings()],
  axisLabels: (anchors, _style, selected) => (selected ? { price: anchors.map((a) => a.price), time: anchors.map((a) => a.time) } : {}),
  draw(ctx, [tail, tip], view, { selected }) {
    const outline = arrowMarkerOutline(tail, tip);
    if (outline.length) {
      ctx.beginPath();
      outline.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fillStyle = selected && !view.styled ? theme.accent2 : cssColor(view.style.color);
      ctx.fill();
    }
    const box = captionBox(view);
    const r = box && arrowMarkerLabelRect(tail, tip, box.w, box.h);
    if (box && r) drawCaption(ctx, view, r, box.lines, box.lineHeight);
  },
  hit([tail, tip], p, view, tolerance = HIT_TOLERANCE) {
    if (pointInPolygon(p, arrowMarkerOutline(tail, tip), tolerance)) return true;
    const box = captionBox(view);
    return !!box && inRect(arrowMarkerLabelRect(tail, tip, box.w, box.h), p, tolerance);
  },
  handles: (pts) => pts,
};
