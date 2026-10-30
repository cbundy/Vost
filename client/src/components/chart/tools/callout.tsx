import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { calloutHit, calloutWedge } from '../../../lib/geometry/notes';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { layoutOf, noteTextSettings, paintTextBox } from './textBox';
import type { DrawingTool } from './types';

/**
 * A text box at the first anchor with a pointer (a filled wedge from the box's nearest edge) to the second.
 * Colours follow TradingView's blue note family (not confirmed against its settings dialog from here).
 */
export const callout: DrawingTool = {
  id: 'callout',
  label: 'Callout',
  group: 'annotations',
  section: 'Notes',
  icon: (
    <Svg>
      <path d="M4 5h12v8H4zM8 13l-3 6 6-6M18 17l2 2" />
    </Svg>
  ),
  anchors: 2,
  text: true,
  settings: noteTextSettings(14, true),
  draw(ctx, [at, target], view, { selected }) {
    const box = layoutOf(view.text, view.style);
    const rect = { x: at.x, y: at.y, width: box.width, height: box.height };
    const wedge = target && calloutWedge(rect, target);
    if (wedge) {
      ctx.beginPath();
      wedge.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.fillStyle = cssColor(view.style.backgroundColor, view.style.backgroundOpacity as number);
      ctx.fill();
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeStyle = selected && !view.styled ? theme.accent2 : cssColor(view.style.borderColor);
      ctx.stroke();
    }
    paintTextBox(ctx, view, at, box, selected);
  },
  hit([at, target], p, view, tolerance = HIT_TOLERANCE) {
    const box = layoutOf(view.text, view.style);
    return calloutHit({ x: at.x, y: at.y, width: box.width, height: box.height }, target ?? at, p, tolerance);
  },
  handles: (pts) => pts,
};
