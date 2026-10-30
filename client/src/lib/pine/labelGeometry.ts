import type { Pt } from '../drawingGeometry';
import type { PxRect, TextLine } from './drawingGeometry';
import type { PineLabel } from './types';

/** Space between a label's text and the edge of its bubble. */
export const LABEL_PAD = 5;
/** How far a bubble's pointer reaches from the bubble to the anchor. */
export const LABEL_POINTER = 6;
/** The gap between a bar's high / low and the anchor of an `abovebar` / `belowbar` label. */
export const LABEL_GAP = 6;
export const LABEL_LINE_HEIGHT = 1.25;

export type LabelShape = 'xcross' | 'cross' | 'triangleup' | 'triangledown' | 'arrowup' | 'arrowdown' | 'flag' | 'circle' | 'square' | 'diamond';

const SHAPES: readonly string[] = ['xcross', 'cross', 'triangleup', 'triangledown', 'arrowup', 'arrowdown', 'flag', 'circle', 'square', 'diamond'];

export interface LabelLayout {
  kind: 'bubble' | 'shape' | 'text';
  /** The bubble's rectangle (kind bubble). */
  rect: PxRect | null;
  /** The bubble's pointer triangle; empty for `label_center` and the corner styles (their corner is the anchor). */
  pointer: Pt[];
  /** The shape and its centre and size (kind shape). */
  shape: { type: LabelShape; cx: number; cy: number; size: number } | null;
  /** The text lines, each `x` the anchor of the label's `textAlign`. */
  lines: TextLine[];
  /** Everything the label covers: the hit area. */
  bounds: PxRect;
  /** The text is drawn with an outline (style_text_outline). */
  outline: boolean;
}

export const labelFont = (o: { textSize: number; bold: boolean; italic: boolean; monospace: boolean }): string =>
  `${o.italic ? 'italic ' : ''}${o.bold ? 'bold ' : ''}${o.textSize}px ${o.monospace ? 'monospace' : 'sans-serif'}`;

/** The anchor pixel of a label from its bar's pixel: an `abovebar` / `belowbar` label sits a gap off the high / low. */
export function labelAnchor(l: Pick<PineLabel, 'yloc'>, at: Pt): Pt {
  return l.yloc === 'abovebar' ? { x: at.x, y: at.y - LABEL_GAP } : l.yloc === 'belowbar' ? { x: at.x, y: at.y + LABEL_GAP } : at;
}

const union = (a: PxRect, b: PxRect): PxRect => ({
  x0: Math.min(a.x0, b.x0),
  y0: Math.min(a.y0, b.y0),
  x1: Math.max(a.x1, b.x1),
  y1: Math.max(a.y1, b.y1),
});

/** Whether the style is one of the bubble styles with a pointer or a corner on the anchor. */
export const isBubbleStyle = (style: string): boolean => /^label_/.test(style);

/**
 * Where a label's bubble or shape and its text go, with the label's anchor at `anchor`. `measure` is the pixel
 * width of a text line in the label's font.
 */
export function labelLayout(l: PineLabel, anchor: Pt, measure: (s: string) => number): LabelLayout {
  const texts = l.text === '' ? [] : l.text.split('\n');
  const lh = l.textSize * LABEL_LINE_HEIGHT;
  const textW = Math.max(0, ...texts.map(measure));
  const textH = lh * texts.length;
  const lineAt = (x0: number, x1: number, top: number): TextLine[] =>
    texts.map((text, i) => ({
      text,
      x: l.textAlign === 'left' ? x0 : l.textAlign === 'right' ? x1 : (x0 + x1) / 2,
      y: top + lh * (i + 0.5),
    }));

  if (isBubbleStyle(l.style)) {
    const w = Math.max(textW + 2 * LABEL_PAD, 2 * LABEL_PAD + 4);
    const h = Math.max(textH + 2 * LABEL_PAD, 2 * LABEL_PAD + 4);
    const { x, y } = anchor;
    const P = LABEL_POINTER;
    let x0 = x - w / 2;
    let y0 = y - h / 2;
    let pointer: Pt[] = [];
    switch (l.style) {
      case 'label_down':
        y0 = y - P - h;
        pointer = [{ x, y }, { x: x - P, y: y - P }, { x: x + P, y: y - P }];
        break;
      case 'label_up':
        y0 = y + P;
        pointer = [{ x, y }, { x: x - P, y: y + P }, { x: x + P, y: y + P }];
        break;
      case 'label_left':
        x0 = x + P;
        pointer = [{ x, y }, { x: x + P, y: y - P }, { x: x + P, y: y + P }];
        break;
      case 'label_right':
        x0 = x - P - w;
        pointer = [{ x, y }, { x: x - P, y: y - P }, { x: x - P, y: y + P }];
        break;
      case 'label_upper_left':
        x0 = x;
        y0 = y;
        break;
      case 'label_upper_right':
        x0 = x - w;
        y0 = y;
        break;
      case 'label_lower_left':
        x0 = x;
        y0 = y - h;
        break;
      case 'label_lower_right':
        x0 = x - w;
        y0 = y - h;
        break;
    }
    const rect = { x0, y0, x1: x0 + w, y1: y0 + h };
    const bounds = pointer.reduce<PxRect>((b, p) => union(b, { x0: p.x, y0: p.y, x1: p.x, y1: p.y }), rect);
    const top = y0 + (h - textH) / 2;
    return { kind: 'bubble', rect, pointer, shape: null, lines: lineAt(x0 + LABEL_PAD, x0 + w - LABEL_PAD, top), bounds, outline: false };
  }

  const textBlock = (cx: number, top: number): { lines: TextLine[]; rect: PxRect } => ({
    lines: lineAt(cx - textW / 2, cx + textW / 2, top),
    rect: { x0: cx - textW / 2, y0: top, x1: cx + textW / 2, y1: top + textH },
  });

  if (SHAPES.includes(l.style)) {
    const size = l.textSize + 4;
    const shape = { type: l.style as LabelShape, cx: anchor.x, cy: anchor.y, size };
    const sRect = { x0: anchor.x - size / 2, y0: anchor.y - size / 2, x1: anchor.x + size / 2, y1: anchor.y + size / 2 };
    // The text sits above a down-pointing shape or one above its bar, below any other.
    const above = l.yloc === 'abovebar' || l.style === 'triangledown' || l.style === 'arrowdown';
    const top = above ? sRect.y0 - 2 - textH : sRect.y1 + 2;
    const block = textBlock(anchor.x, top);
    return {
      kind: 'shape',
      rect: null,
      pointer: [],
      shape,
      lines: block.lines,
      bounds: texts.length ? union(sRect, block.rect) : sRect,
      outline: false,
    };
  }

  // style_none and style_text_outline: the text alone, centred on the anchor.
  const block = textBlock(anchor.x, anchor.y - textH / 2);
  return { kind: 'text', rect: null, pointer: [], shape: null, lines: block.lines, bounds: block.rect, outline: l.style === 'text_outline' };
}

/** Whether a point is on the label (its bubble, pointer, shape or text). */
export function labelHit(layout: Pick<LabelLayout, 'bounds'>, p: Pt): boolean {
  const b = layout.bounds;
  return p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
}
