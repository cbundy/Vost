import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { priceTagBody, priceTagOutline } from '../../../lib/geometry/markers';
import { pointInPolygon } from '../../../lib/geometry/shapes';
import { noteFont } from '../../../lib/textLayout';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { axisAtAnchors } from './axisAtAnchors';
import { colorField, numberField } from './fields';
import { NOTE_BLUE, NOTE_WHITE, measureWidth } from './textBox';
import type { DrawingTool, ToolView } from './types';

const PAD = 6;

function tagOf(view: ToolView) {
  const size = (view.style.textSize as number | undefined) ?? 12;
  const text = view.anchors[0] ? view.formatPrice(view.anchors[0].price) : '';
  const height = Math.round(size * 1.25) + PAD;
  return { size, text, box: { width: Math.ceil(measureWidth(text, { size, bold: true, italic: false })) + PAD * 2, height } };
}

/**
 * A price label: a pointed tag with its point at the anchor and the anchor's price in its body. Defaults are
 * TradingView's blue with white text (not confirmed against its settings dialog from here).
 */
export const priceLabel: DrawingTool = {
  id: 'priceLabel',
  label: 'Price label',
  group: 'annotations',
  section: 'Notes',
  icon: (
    <Svg>
      <path d="M3 12l5-5h13v10H8zM12 12h6" />
    </Svg>
  ),
  anchors: 1,
  settings: [colorField('color', 'Colour', NOTE_BLUE), colorField('textColor', 'Text colour', NOTE_WHITE), numberField('textSize', 'Text size', 12, 8, 48, 1)],
  axisLabels: axisAtAnchors,
  draw(ctx, [tip], view, { selected }) {
    const { size, text, box } = tagOf(view);
    const outline = priceTagOutline(tip, box, view);
    ctx.beginPath();
    outline.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fillStyle = cssColor(view.style.color);
    ctx.fill();
    if (selected) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = view.styled ? cssColor(view.style.color) : theme.accent2;
      ctx.stroke();
    }
    const body = priceTagBody(outline);
    ctx.font = noteFont({ size, bold: true, italic: false });
    ctx.fillStyle = cssColor(view.style.textColor);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, body.x + body.w / 2, body.y + body.h / 2);
  },
  hit: ([tip], p, view, tolerance = HIT_TOLERANCE) => pointInPolygon(p, priceTagOutline(tip, tagOf(view).box, view), tolerance),
  handles: ([tip]) => [tip],
};
