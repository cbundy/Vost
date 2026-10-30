import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { arrowMarkLabelRect, arrowMarkOutline, inRect, pointInPolygon, type MarkDirection } from '../../../lib/geometry/shapes';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { captionBox, captionSettings, drawCaption } from './captionLabel';
import { colorField } from './fields';
import type { DrawingTool } from './types';

/** An arrow mark: one anchor on a bar's time, a small filled arrow with its tip at the point and an optional label beyond its tail. */
function arrowMark(dir: MarkDirection): DrawingTool {
  const up = dir === 'up';
  return {
    id: up ? 'arrowMarkUp' : 'arrowMarkDown',
    label: up ? 'Arrow mark up' : 'Arrow mark down',
    group: 'shapes',
    section: 'Shapes',
    icon: (
      <Svg>
        <path d={up ? 'M12 4l6 7h-4v9h-4v-9H6z' : 'M12 20l6-7h-4V4h-4v9H6z'} />
      </Svg>
    ),
    anchors: 1,
    caption: true,
    barTime: true,
    settings: [colorField('color', 'Colour', up ? 'green' : 'red'), ...captionSettings()],
    axisLabels: (anchors, _style, selected) => (selected ? { price: anchors.map((a) => a.price), time: anchors.map((a) => a.time) } : {}),
    draw(ctx, [tip], view, { selected }) {
      ctx.beginPath();
      arrowMarkOutline(tip, dir).forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fillStyle = selected && !view.styled ? theme.accent2 : cssColor(view.style.color);
      ctx.fill();
      const box = captionBox(view);
      if (box) drawCaption(ctx, view, arrowMarkLabelRect(tip, dir, box.w, box.h), box.lines, box.lineHeight);
    },
    hit([tip], p, view, tolerance = HIT_TOLERANCE) {
      if (pointInPolygon(p, arrowMarkOutline(tip, dir), tolerance)) return true;
      const box = captionBox(view);
      return !!box && inRect(arrowMarkLabelRect(tip, dir, box.w, box.h), p, tolerance);
    },
    handles: (pts) => pts,
  };
}

export const arrowMarkUp = arrowMark('up');
export const arrowMarkDown = arrowMark('down');
