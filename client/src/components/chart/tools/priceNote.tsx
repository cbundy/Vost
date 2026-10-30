import { HIT_TOLERANCE, distToSegment, type Pt } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { DOT_R } from '../../../lib/geometry/markers';
import { keepInside } from '../../../lib/geometry/notes';
import { inRect, type Rect } from '../../../lib/geometry/shapes';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { captionBox, captionSettings, drawCaption } from './captionLabel';
import { colorField } from './fields';
import { NOTE_BLUE, NOTE_WHITE } from './textBox';
import type { DrawingTool, ToolView } from './types';

const PAD = 6;

/** The box's lines (the price, then the label) and its rectangle centred on `at`, kept inside the pane. */
function boxOf(at: Pt, view: ToolView) {
  const price = view.anchors[0] ? view.formatPrice(view.anchors[0].price) : '';
  const box = captionBox({ ...view, text: [price, view.text].filter(Boolean).join('\n') });
  if (!box) return null;
  const size = { width: box.w + PAD * 2, height: box.h + PAD * 2 };
  const r = keepInside(at.x - size.width / 2, at.y - size.height / 2, size, view);
  const rect: Rect = { x: r.x, y: r.y, w: size.width, h: size.height };
  return { box, rect };
}

/**
 * A price note: a dot at the first anchor joined by a straight connector to a blue box at the second that shows the
 * dot's price (then the optional label). Defaults are TradingView's blue with white text (not confirmed against its
 * settings dialog from here).
 */
export const priceNote: DrawingTool = {
  id: 'priceNote',
  label: 'Price note',
  group: 'annotations',
  section: 'Notes',
  icon: (
    <Svg>
      <path d="M5 19h.01M5 19l8-8M11 4h9v7h-9z" />
    </Svg>
  ),
  anchors: 2,
  caption: true,
  settings: [colorField('color', 'Colour', NOTE_BLUE), ...captionSettings().map((f) => (f.key === 'textColor' ? { ...f, default: NOTE_WHITE } : f))],
  axisLabels: (anchors, _style, selected) => (selected && anchors[0] ? { price: [anchors[0].price], time: [anchors[0].time] } : {}),
  draw(ctx, [dot, at], view, { selected }) {
    const color = selected && !view.styled ? theme.accent2 : cssColor(view.style.color);
    if (at) {
      ctx.beginPath();
      ctx.moveTo(dot.x, dot.y);
      ctx.lineTo(at.x, at.y);
      ctx.lineWidth = selected ? 2 : 1.5;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    const b = at && boxOf(at, view);
    if (!b) return;
    ctx.beginPath();
    ctx.roundRect(b.rect.x, b.rect.y, b.rect.w, b.rect.h, 4);
    ctx.fillStyle = color;
    ctx.fill();
    drawCaption(ctx, view, { x: b.rect.x + PAD, y: b.rect.y + PAD, w: b.box.w, h: b.box.h }, b.box.lines, b.box.lineHeight);
  },
  hit([dot, at], p, view, tolerance = HIT_TOLERANCE) {
    if (Math.hypot(p.x - dot.x, p.y - dot.y) <= DOT_R + tolerance) return true;
    if (!at) return false;
    if (distToSegment(p, dot, at) <= tolerance) return true;
    const b = boxOf(at, view);
    return !!b && inRect(b.rect, p, tolerance);
  },
  handles: (pts) => pts,
};
