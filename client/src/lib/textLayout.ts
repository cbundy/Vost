/**
 * The pure layout of a text box (a note): the wrapped lines, each line's x offset for its alignment, and the box
 * size. The measuring function is passed in, so this module has no DOM. Text and Anchored text share it.
 */
import { wrapText } from './drawingGeometry';

export type TextAlign = 'left' | 'center' | 'right';

/** What a note's look depends on. */
export type NoteFont = { size: number; bold: boolean; italic: boolean };

export type TextBoxOpts = NoteFont & {
  align: TextAlign;
  /** Space between the box edge and its text, on every side. */
  pad: number;
  /** Whether lines break at `wrapWidth`; off, they break only at newlines. */
  wrap: boolean;
  /** Widest a line of text may be when wrapping. */
  wrapWidth: number;
  /** Widest the whole box may be (padding included); longer lines are broken. */
  maxWidth?: number;
};

export type TextBoxLayout = {
  lines: string[];
  /** The x offset of each line from the box's left edge. */
  offsets: number[];
  width: number;
  height: number;
  lineHeight: number;
};

/** Canvas / CSS font of a note. */
export const noteFont = (f: NoteFont): string => `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size}px sans-serif`;
/** Line height of a note: 16 px at 12 px. */
export const noteLine = (size: number): number => Math.round((size * 4) / 3);

/** Lays a text out in a box. `measure` gives the pixel width of one line in the note's font. */
export function textBoxLayout(text: string, opts: TextBoxOpts, measure: (s: string) => number): TextBoxLayout {
  let limit = opts.wrap ? opts.wrapWidth : Infinity;
  if (opts.maxWidth !== undefined) limit = Math.min(limit, Math.max(1, opts.maxWidth - opts.pad * 2));
  const lines = Number.isFinite(limit) ? wrapText(text, limit, measure) : text.split('\n');
  const widths = lines.map(measure);
  const inner = Math.ceil(Math.max(0, ...widths));
  const width = inner + opts.pad * 2;
  const lineHeight = noteLine(opts.size);
  const offsets = widths.map((w) => opts.pad + (opts.align === 'center' ? (inner - w) / 2 : opts.align === 'right' ? inner - w : 0));
  return { lines, offsets, width, height: lines.length * lineHeight + opts.pad * 2, lineHeight };
}
