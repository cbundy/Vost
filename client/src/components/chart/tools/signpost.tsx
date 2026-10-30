import { HIT_TOLERANCE } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import { anchorOutside, poleHit, signpostShape, type PlatePosition } from '../../../lib/geometry/markers';
import { inRect } from '../../../lib/geometry/shapes';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { axisAtAnchors } from './axisAtAnchors';
import { captionBox, captionSettings, drawCaption } from './captionLabel';
import { choiceField, colorField } from './fields';
import { NOTE_BLUE, NOTE_WHITE } from './textBox';
import type { DrawingTool, ToolView } from './types';
import type { Pt } from '../../../lib/drawingGeometry';

const PLATE_PAD = 6;
const EMOJI_SIZE = 18;
const MIN_PLATE = 28;

export const SIGNPOST_EMOJI = [
  { value: 'none', label: 'None' },
  { value: '🚩', label: 'Flag' },
  { value: '⭐', label: 'Star' },
  { value: '📍', label: 'Pin' },
  { value: '🔥', label: 'Fire' },
  { value: '🚀', label: 'Rocket' },
] as const;

function plateOf(view: ToolView) {
  const emoji = (view.style.emoji as string | undefined) ?? 'none';
  const box = emoji === 'none' ? captionBox(view) : null;
  const size = emoji !== 'none' ? { width: MIN_PLATE, height: MIN_PLATE } : box ? { width: Math.max(MIN_PLATE, box.w + PLATE_PAD * 2), height: Math.max(MIN_PLATE, box.h + PLATE_PAD * 2) } : { width: MIN_PLATE, height: MIN_PLATE };
  return { emoji, box, size, position: (view.style.position === 'below' ? 'below' : 'above') as PlatePosition };
}

function shapeOf(anchor: Pt, view: ToolView) {
  const { size, position } = plateOf(view);
  return signpostShape(anchor, size, position, view, anchorOutside(anchor, view));
}

/**
 * A signpost: a pole from the anchor (on a bar's time) to a rounded plate above or below it. The plate shows the
 * chosen emoji, or the label set on the Text tab. Defaults are TradingView's blue with white text (not confirmed
 * against its settings dialog from here).
 */
export const signpost: DrawingTool = {
  id: 'signpost',
  label: 'Signpost',
  group: 'annotations',
  section: 'Notes',
  icon: (
    <Svg>
      <path d="M12 3v18M6 5h10l3 3-3 3H6zM8 14h10v5H8z" />
    </Svg>
  ),
  anchors: 1,
  caption: true,
  barTime: true,
  settings: [
    colorField('color', 'Colour', NOTE_BLUE),
    choiceField('position', 'Position', 'above', [{ value: 'above', label: 'Above' }, { value: 'below', label: 'Below' }]),
    choiceField('emoji', 'Emoji', 'none', SIGNPOST_EMOJI),
    ...captionSettings().map((f) => (f.key === 'textColor' ? { ...f, default: NOTE_WHITE } : f)),
  ],
  axisLabels: axisAtAnchors,
  draw(ctx, [anchor], view, { selected }) {
    const { emoji, box } = plateOf(view);
    const { pole, plate } = shapeOf(anchor, view);
    const color = selected && !view.styled ? theme.accent2 : cssColor(view.style.color);
    ctx.beginPath();
    ctx.moveTo(pole[0].x, pole[0].y);
    ctx.lineTo(pole[1].x, pole[1].y);
    ctx.lineWidth = selected ? 2 : 1.5;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(plate.x, plate.y, plate.w, plate.h, 5);
    ctx.fillStyle = color;
    ctx.fill();
    if (emoji !== 'none') {
      ctx.font = `${EMOJI_SIZE}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, plate.x + plate.w / 2, plate.y + plate.h / 2);
    } else if (box) {
      drawCaption(ctx, view, { x: plate.x + (plate.w - box.w) / 2, y: plate.y + (plate.h - box.h) / 2, w: box.w, h: box.h }, box.lines, box.lineHeight);
    }
  },
  hit([anchor], p, view, tolerance = HIT_TOLERANCE) {
    const { pole, plate } = shapeOf(anchor, view);
    return poleHit(pole, p, tolerance) || inRect(plate, p, tolerance);
  },
  handles: (pts) => pts,
};
