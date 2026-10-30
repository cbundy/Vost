import type { SettingField } from '../../../lib/drawingStyle';
import { cssColor } from '../../../lib/drawingStyle';
import type { Rect } from '../../../lib/geometry/shapes';
import { noteFont } from '../../../lib/textLayout';
import { boolField, colorField, numberField } from './fields';
import { measureWidth } from './textBox';
import type { ToolView } from './types';

export const CAPTION_SIZE = 12;

/** The Text tab of a tool with an optional label: text colour, size, bold and italic (the label itself is edited there too). */
export function captionSettings(): SettingField[] {
  return [
    colorField('textColor', 'Text colour', 'text', 'text'),
    numberField('textSize', 'Text size', CAPTION_SIZE, 8, 48, 1, 'text'),
    boolField('bold', 'Bold', false, 'text'),
    boolField('italic', 'Italic', false, 'text'),
  ];
}

function fontOf(view: ToolView) {
  return { size: (view.style.textSize as number | undefined) ?? CAPTION_SIZE, bold: view.style.bold === true, italic: view.style.italic === true };
}

/** The label's lines and the size of the box they fill; null when the drawing has no label. */
export function captionBox(view: ToolView): { lines: string[]; w: number; h: number; lineHeight: number } | null {
  if (!view.text) return null;
  const font = fontOf(view);
  const lines = view.text.split('\n');
  const lineHeight = Math.round(font.size * 1.25);
  return { lines, w: Math.max(...lines.map((l) => measureWidth(l, font))), h: lineHeight * lines.length, lineHeight };
}

/** Draws the label's lines centred in `r`. */
export function drawCaption(ctx: CanvasRenderingContext2D, view: ToolView, r: Rect, lines: string[], lineHeight: number): void {
  ctx.font = noteFont(fontOf(view));
  ctx.fillStyle = cssColor(view.style.textColor ?? 'text');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, r.x + r.w / 2, r.y + lineHeight * i + lineHeight / 2));
}
