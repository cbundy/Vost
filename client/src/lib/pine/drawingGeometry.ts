import { extendSegment, type Pt } from '../drawingGeometry';
import type { PineExtend } from './types';

/** The pixels a line is drawn between: its two ends, continued to the pane edge as `extend` says. */
export function lineSpan(a: Pt, b: Pt, extend: PineExtend, width: number, height: number): [Pt, Pt] {
  return extendSegment(a, b, width, height, extend === 'l' || extend === 'b', extend === 'r' || extend === 'b');
}

export interface PxRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A box's pixel rectangle; an extended side runs to the pane edge. */
export function boxRect(a: Pt, b: Pt, extend: PineExtend, width: number): PxRect {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  return {
    x0: extend === 'l' || extend === 'b' ? 0 : x0,
    x1: extend === 'r' || extend === 'b' ? width : x1,
    y0: Math.min(a.y, b.y),
    y1: Math.max(a.y, b.y),
  };
}

export interface TextLine {
  text: string;
  x: number;
  /** The line's vertical middle. */
  y: number;
}

export const BOX_PAD = 4;
const LINE_HEIGHT = 1.25;

/** Breaks `text` at its newlines and, when `maxWidth` is given, at word boundaries so no line is wider (one long word keeps its line). */
export function wrapText(text: string, maxWidth: number | null, measure: (s: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    if (maxWidth === null) {
      out.push(para);
      continue;
    }
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next) > maxWidth) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Where a box's text lines go inside its rectangle: `x` is the anchor of the line's `halign`. */
export function boxTextLines(
  rect: PxRect,
  text: string,
  size: number,
  halign: 'left' | 'center' | 'right',
  valign: 'top' | 'center' | 'bottom',
  wrap: boolean,
  measure: (s: string) => number,
): TextLine[] {
  if (!text) return [];
  const inner = Math.max(0, rect.x1 - rect.x0 - 2 * BOX_PAD);
  const lines = wrapText(text, wrap ? inner : null, measure);
  const h = size * LINE_HEIGHT;
  const block = h * lines.length;
  const top =
    valign === 'top' ? rect.y0 + BOX_PAD : valign === 'bottom' ? rect.y1 - BOX_PAD - block : (rect.y0 + rect.y1) / 2 - block / 2;
  const x = halign === 'left' ? rect.x0 + BOX_PAD : halign === 'right' ? rect.x1 - BOX_PAD : (rect.x0 + rect.x1) / 2;
  return lines.map((t, i) => ({ text: t, x, y: top + h * (i + 0.5) }));
}

const CURVE_STEPS = 12;

/**
 * The points a polyline is drawn through. Straight: the points themselves. Curved: a Catmull-Rom spline
 * sampled between them, which passes through every point (and back to the first when closed).
 */
export function polylinePoints(pts: readonly Pt[], curved: boolean, closed: boolean): Pt[] {
  if (!curved || pts.length < 3) return pts.map((p) => ({ ...p }));
  const n = pts.length;
  const at = (i: number): Pt => (closed ? pts[((i % n) + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
  const segs = closed ? n : n - 1;
  const out: Pt[] = [];
  for (let i = 0; i < segs; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < CURVE_STEPS; k++) {
      const t = k / CURVE_STEPS;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push(closed ? { ...pts[0] } : { ...pts[n - 1] });
  return out;
}

/** The polygon between two drawn spans, in order around its outline. */
export function linefillPolygon(s1: readonly [Pt, Pt], s2: readonly [Pt, Pt]): Pt[] {
  return [s1[0], s1[1], s2[1], s2[0]].map((p) => ({ ...p }));
}
