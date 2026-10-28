import { HIT_TOLERANCE, pointInRect, wrapText, type Pt } from '../../../lib/drawingGeometry';
import { theme } from '../../../lib/theme';
import { Svg } from '../../DrawingIcons';
import type { DrawingTool } from './types';

/** Wrap width of a note's text, in pixels. */
export const NOTE_WRAP = 240;
export const NOTE_PAD = 6;
export const NOTE_LINE = 16;
export const NOTE_FONT = '12px sans-serif';

let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureWidth(s: string): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (measureCtx) measureCtx.font = NOTE_FONT;
  }
  return measureCtx ? measureCtx.measureText(s).width : s.length * 7;
}

/** The wrapped lines and the pixel size of a note's box. */
export function noteLayout(text: string): { lines: string[]; width: number; height: number } {
  const lines = wrapText(text, NOTE_WRAP, measureWidth);
  const widest = Math.max(...lines.map(measureWidth));
  return { lines, width: Math.ceil(widest) + NOTE_PAD * 2, height: lines.length * NOTE_LINE + NOTE_PAD * 2 };
}

function corner(a: Pt, text: string): Pt {
  const { width, height } = noteLayout(text);
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
  draw(ctx, [a], view, { selected }) {
    const { lines, width, height } = noteLayout(view.text);
    ctx.beginPath();
    ctx.roundRect(a.x, a.y, width, height, 4);
    ctx.fillStyle = 'rgba(23,23,27,0.92)';
    ctx.fill();
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? theme.accent2 : theme.border3;
    ctx.stroke();
    ctx.font = NOTE_FONT;
    ctx.fillStyle = theme.text;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    lines.forEach((l, i) => ctx.fillText(l, a.x + NOTE_PAD, a.y + NOTE_PAD + NOTE_LINE * i + NOTE_LINE / 2));
  },
  hit: ([a], p, view, tolerance = HIT_TOLERANCE) => pointInRect(p, a, corner(a, view.text), tolerance),
  handles: ([a]) => [a],
};
