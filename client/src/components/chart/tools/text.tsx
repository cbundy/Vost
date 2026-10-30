import { HIT_TOLERANCE, pointInRect, wrapText, type Pt } from '../../../lib/drawingGeometry';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import { cssColor } from '../../../lib/drawingStyle';
import { boolField, colorField, numberField, opacityField } from './fields';
import type { DrawingTool, ToolView } from './types';

/** Wrap width of a note's text, in pixels. */
export const NOTE_WRAP = 240;
export const NOTE_PAD = 6;
/** Text size of an unstyled note. */
export const NOTE_SIZE = 12;

/** What a note's look depends on. */
export type NoteFont = { size: number; bold: boolean; italic: boolean };
const DEFAULT_FONT: NoteFont = { size: NOTE_SIZE, bold: false, italic: false };

export const noteFont = (f: NoteFont): string => `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size}px sans-serif`;
/** Line height of a note: 16 px at the default size. */
export const noteLine = (size: number): number => Math.round((size * 4) / 3);

let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureWidth(s: string, font: NoteFont): number {
  if (measureCtx === undefined) measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  if (!measureCtx) return s.length * font.size * 0.6;
  measureCtx.font = noteFont(font);
  return measureCtx.measureText(s).width;
}

/** The wrapped lines and the pixel size of a note's box. */
export function noteLayout(text: string, font: NoteFont = DEFAULT_FONT): { lines: string[]; width: number; height: number } {
  const w = (s: string) => measureWidth(s, font);
  const lines = wrapText(text, NOTE_WRAP, w);
  const widest = Math.max(...lines.map(w));
  return { lines, width: Math.ceil(widest) + NOTE_PAD * 2, height: lines.length * noteLine(font.size) + NOTE_PAD * 2 };
}

const fontOf = (view: ToolView): NoteFont => ({ size: view.style.size as number, bold: view.style.bold === true, italic: view.style.italic === true });

function corner(a: Pt, view: ToolView): Pt {
  const { width, height } = noteLayout(view.text, fontOf(view));
  return { x: a.x + width, y: a.y + height };
}

export const text: DrawingTool = {
  id: 'text',
  label: 'Text',
  icon: (
    <Svg>
      <path d="M5 6V5h14v1M12 5v14M9 19h6" />
    </Svg>
  ),
  anchors: 1,
  text: true,
  settings: [
    colorField('color', 'Text colour', 'text'),
    numberField('size', 'Text size', NOTE_SIZE, 8, 48, 1),
    boolField('bold', 'Bold', false),
    boolField('italic', 'Italic', false),
    colorField('backgroundColor', 'Background colour', 'panel2'),
    opacityField('backgroundOpacity', 'Background opacity', 0.92),
    colorField('borderColor', 'Border colour', 'border3'),
  ],
  draw(ctx, [a], view, { selected }) {
    const font = fontOf(view);
    const { lines, width, height } = noteLayout(view.text, font);
    const line = noteLine(font.size);
    ctx.beginPath();
    ctx.roundRect(a.x, a.y, width, height, 4);
    ctx.fillStyle = cssColor(view.style.backgroundColor, view.style.backgroundOpacity as number);
    ctx.fill();
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected && !view.styled ? theme.accent2 : cssColor(view.style.borderColor);
    ctx.stroke();
    ctx.font = noteFont(font);
    ctx.fillStyle = cssColor(view.style.color);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, a.x + NOTE_PAD, a.y + NOTE_PAD + line * i + line / 2));
  },
  hit: ([a], p, view, tolerance = HIT_TOLERANCE) => pointInRect(p, a, corner(a, view), tolerance),
  handles: ([a]) => [a],
};
