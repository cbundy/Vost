import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { commentHit, commentShape } from '../../../lib/geometry/notes';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { layoutOf, noteTextSettings, paintTextBox } from './textBox';
import type { DrawingTool } from './types';

/** Corner radius of the bubble. */
const BUBBLE_RADIUS = 10;

/**
 * A speech bubble whose tail tip is the anchor; the bubble sits above and to the right of the tip, flipping where the
 * pane's edge needs it. Colours follow TradingView's blue note family (not confirmed against its settings dialog from here).
 */
export const comment: DrawingTool = {
  id: 'comment',
  label: 'Comment',
  group: 'annotations',
  section: 'Notes',
  icon: (
    <Svg>
      <path d="M5 5h14v10h-8l-4 4v-4H5z" />
    </Svg>
  ),
  anchors: 1,
  text: true,
  settings: noteTextSettings(14, true),
  draw(ctx, [tip], view, { selected }) {
    const box = layoutOf(view.text, view.style);
    const shape = commentShape(tip, box, view);
    const stroke = selected && !view.styled ? theme.accent2 : cssColor(view.style.borderColor);
    const fill = cssColor(view.style.backgroundColor, view.style.backgroundOpacity as number);
    // The tail first, then the bubble over its base, so the join has no border line.
    ctx.beginPath();
    shape.tail.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = stroke;
    ctx.stroke();
    paintTextBox(ctx, view, shape.rect, box, selected, BUBBLE_RADIUS);
  },
  hit([tip], p, view, tolerance = HIT_TOLERANCE) {
    return commentHit(commentShape(tip, layoutOf(view.text, view.style), view), p, tolerance);
  },
  handles: ([tip]) => [tip],
};
