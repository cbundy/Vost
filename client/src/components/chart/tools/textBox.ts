import { HIT_TOLERANCE, pointInRect, type Pt } from '../../../lib/drawingGeometry';
import { cssColor } from '../../../lib/drawingStyle';
import type { SettingField } from '../../../lib/drawingStyle';
import { noteFont, textBoxLayout, type NoteFont, type TextAlign, type TextBoxLayout, type TextBoxOpts } from '../../../lib/textLayout';
import { theme } from '../../../lib/theme';
import { boolField, choiceField, colorField, numberField, opacityField } from './fields';
import type { DrawingTool, ToolView } from './types';

export const NOTE_PAD = 6;
/** Wrap width and size of a Text note; saved notes keep this look. */
export const NOTE_WRAP = 240;
export const NOTE_SIZE = 12;

export const ALIGN_OPTIONS: readonly { value: TextAlign; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Centre' },
  { value: 'right', label: 'Right' },
];

/** The settings of a text tool: all the text ones on the Text tab, the box look on Style. */
export function textSettings(size: number, wrap: boolean): readonly SettingField[] {
  return [
    colorField('color', 'Text colour', 'text', 'text'),
    numberField('size', 'Text size', size, 8, 48, 1, 'text'),
    boolField('bold', 'Bold', false, 'text'),
    boolField('italic', 'Italic', false, 'text'),
    choiceField('align', 'Alignment', 'left', ALIGN_OPTIONS, 'text'),
    boolField('wrap', 'Wrap text', wrap, 'text'),
    numberField('wrapWidth', 'Wrap width', NOTE_WRAP, 40, 1000, 1, 'text'),
    colorField('backgroundColor', 'Background colour', 'panel2'),
    opacityField('backgroundOpacity', 'Background opacity', 0.92),
    colorField('borderColor', 'Border colour', 'border3'),
  ];
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
/** Width of a line in a font, by the canvas (an estimate where there is none). */
export function measureWidth(s: string, font: NoteFont): number {
  if (measureCtx === undefined) measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measureCtx) return s.length * font.size * 0.6;
  measureCtx.font = noteFont(font);
  return measureCtx.measureText(s).width;
}

/** The layout options a style gives. */
export function boxOpts(style: Readonly<Record<string, unknown>>): TextBoxOpts {
  return {
    size: style.size as number,
    bold: style.bold === true,
    italic: style.italic === true,
    align: (style.align as TextAlign) ?? 'left',
    pad: NOTE_PAD,
    wrap: style.wrap !== false,
    wrapWidth: (style.wrapWidth as number | undefined) ?? NOTE_WRAP,
  };
}

/** The layout of a text in a style, measured on the canvas. */
export function layoutOf(text: string, style: Readonly<Record<string, unknown>>): TextBoxLayout {
  const opts = boxOpts(style);
  return textBoxLayout(text, opts, (s) => measureWidth(s, opts));
}

/** The box's top-left pixel: a pane-anchored box is kept inside the pane. */
function origin(a: Pt, box: TextBoxLayout, view: ToolView, pane: boolean): Pt {
  if (!pane) return a;
  return { x: Math.max(0, Math.min(a.x, view.width - box.width)), y: Math.max(0, Math.min(a.y, view.height - box.height)) };
}

/** The shared drawing, hit and handles of a text tool. */
export function textBoxTool(pane: boolean): Pick<DrawingTool, 'draw' | 'hit' | 'handles'> {
  return {
    draw(ctx, [p], view, { selected }) {
      const box = layoutOf(view.text, view.style);
      const a = origin(p, box, view, pane);
      ctx.beginPath();
      ctx.roundRect(a.x, a.y, box.width, box.height, 4);
      ctx.fillStyle = cssColor(view.style.backgroundColor, view.style.backgroundOpacity as number);
      ctx.fill();
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeStyle = selected && !view.styled ? theme.accent2 : cssColor(view.style.borderColor);
      ctx.stroke();
      ctx.font = noteFont(boxOpts(view.style));
      ctx.fillStyle = cssColor(view.style.color);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      box.lines.forEach((l, i) => ctx.fillText(l, a.x + box.offsets[i], a.y + NOTE_PAD + box.lineHeight * i + box.lineHeight / 2));
    },
    hit([p], at, view, tolerance = HIT_TOLERANCE) {
      const box = layoutOf(view.text, view.style);
      const a = origin(p, box, view, pane);
      return pointInRect(at, a, { x: a.x + box.width, y: a.y + box.height }, tolerance);
    },
    handles: ([p], view) => [origin(p, layoutOf(view.text, view.style), view, pane)],
  };
}
