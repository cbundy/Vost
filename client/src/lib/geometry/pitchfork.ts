/**
 * Pure maths of the pitchfork tools (Pitchfork, Schiff, Modified Schiff, Inside). No chart imports.
 *
 * Anchors are P1, P2, P3 and M is the midpoint of P2 and P3. The median runs from an origin O through M; each level
 * k draws two lines parallel to the median through M + k(P3 - M) and M - k(P3 - M), so level 1 passes through P2 and P3.
 * The origin is P1 (Pitchfork), (P1.x, midY of P1 and P2) (Schiff) or the midpoint of P1 and P2 (Modified Schiff).
 *
 * Inside: TradingView's own help pages and charting-library reference could not be read from the build environment
 * (the support pages returned 403/404 or an unrelated article), so its construction is NOT confirmed. This module
 * mirrors Schiff: the origin keeps P1's y and takes the x midway between P1 and P2 (midX of P1 and P2, P1.y).
 * Replace {@link medianOrigin}'s 'inside' case if TradingView's documented construction differs.
 */
import type { Pt } from '../drawingGeometry';
import { pointInPolygon } from './channels';

export type PitchforkVariant = 'original' | 'schiff' | 'modifiedSchiff' | 'inside';

export const PITCHFORK_VARIANTS: readonly { value: PitchforkVariant; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'schiff', label: 'Schiff' },
  { value: 'modifiedSchiff', label: 'Modified Schiff' },
  { value: 'inside', label: 'Inside' },
];

export type PitchforkLevel = { value: number; color: string; on: boolean };

/** TradingView's default levels: only 0.5 and 1 are on. */
export const DEFAULT_PITCHFORK_LEVELS: readonly PitchforkLevel[] = [
  { value: 0.25, color: '#ffb74d', on: false },
  { value: 0.382, color: '#81c784', on: false },
  { value: 0.5, color: '#089981', on: true },
  { value: 0.618, color: '#089981', on: false },
  { value: 0.75, color: '#00bcd4', on: false },
  { value: 1, color: '#2962FF', on: true },
  { value: 1.5, color: '#9c27b0', on: false },
  { value: 1.75, color: '#e91e63', on: false },
  { value: 2, color: '#F77C80', on: false },
];

const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** The point the median starts from. */
export function medianOrigin(variant: PitchforkVariant, p1: Pt, p2: Pt, _p3?: Pt): Pt {
  switch (variant) {
    case 'schiff':
      return { x: p1.x, y: (p1.y + p2.y) / 2 };
    case 'modifiedSchiff':
      return mid(p1, p2);
    case 'inside':
      return { x: (p1.x + p2.x) / 2, y: p1.y };
    default:
      return { ...p1 };
  }
}

/**
 * The part of the line q + t*d inside [0,width] x [0,height], from t = 0 forward (and from the pane's far side
 * backward when `backward`). Null when nothing of it is on the pane or the direction is zero.
 */
export function clipLine(q: Pt, d: Pt, width: number, height: number, backward: boolean): [Pt, Pt] | null {
  if (!(d.x !== 0 || d.y !== 0) || ![q.x, q.y, d.x, d.y].every(Number.isFinite)) return null;
  let lo = -Infinity;
  let hi = Infinity;
  const axes: [number, number, number][] = [[q.x, d.x, width], [q.y, d.y, height]];
  for (const [s, v, max] of axes) {
    if (v === 0) {
      if (s < 0 || s > max) return null;
      continue;
    }
    const t0 = (0 - s) / v;
    const t1 = (max - s) / v;
    lo = Math.max(lo, Math.min(t0, t1));
    hi = Math.min(hi, Math.max(t0, t1));
  }
  const from = backward ? lo : Math.max(lo, 0);
  if (!(hi >= from) || hi < 0) return null;
  return [{ x: q.x + d.x * from, y: q.y + d.y * from }, { x: q.x + d.x * hi, y: q.y + d.y * hi }];
}

/** The polygon clipped to the pane rectangle (Sutherland-Hodgman). */
export function clipPolygon(poly: readonly Pt[], width: number, height: number): Pt[] {
  const edges: { inside: (p: Pt) => boolean; cut: (a: Pt, b: Pt) => Pt }[] = [
    { inside: (p) => p.x >= 0, cut: (a, b) => ({ x: 0, y: a.y + ((b.y - a.y) * (0 - a.x)) / (b.x - a.x) }) },
    { inside: (p) => p.x <= width, cut: (a, b) => ({ x: width, y: a.y + ((b.y - a.y) * (width - a.x)) / (b.x - a.x) }) },
    { inside: (p) => p.y >= 0, cut: (a, b) => ({ y: 0, x: a.x + ((b.x - a.x) * (0 - a.y)) / (b.y - a.y) }) },
    { inside: (p) => p.y <= height, cut: (a, b) => ({ y: height, x: a.x + ((b.x - a.x) * (height - a.y)) / (b.y - a.y) }) },
  ];
  let out = [...poly];
  for (const e of edges) {
    const input = out;
    out = [];
    input.forEach((cur, i) => {
      const prev = input[(i + input.length - 1) % input.length];
      if (e.inside(cur)) {
        if (!e.inside(prev)) out.push(e.cut(prev, cur));
        out.push(cur);
      } else if (e.inside(prev)) out.push(e.cut(prev, cur));
    });
    if (out.length === 0) break;
  }
  return out;
}

export type PitchforkLine = { value: number; color: string; side: 1 | -1; seg: [Pt, Pt] };
export type PitchforkShape = {
  origin: Pt;
  /** The median clipped to the pane (null when it has no direction or is off the pane). */
  median: [Pt, Pt] | null;
  /** The P2-P3 line. */
  handle: [Pt, Pt];
  /** Two lines per enabled level, nearest the median first on each side. */
  lines: PitchforkLine[];
  /** Fills between adjacent lines on each side, from the median outward, in the outer level's colour. */
  fills: { color: string; poly: Pt[] }[];
};

/** Every line and fill of a pitchfork on a pane of the given size; finite or empty output for degenerate input. */
export function pitchforkLines(
  variant: PitchforkVariant,
  [p1, p2, p3]: readonly [Pt, Pt, Pt],
  levels: readonly PitchforkLevel[],
  width: number,
  height: number,
  extend: boolean,
): PitchforkShape {
  const origin = medianOrigin(variant, p1, p2, p3);
  const m = mid(p2, p3);
  const d = { x: m.x - origin.x, y: m.y - origin.y };
  const hasDir = d.x !== 0 || d.y !== 0;
  const median = hasDir ? clipLine(origin, d, width, height, extend) : null;
  const on = levels.filter((l) => l.on && Number.isFinite(l.value)).sort((a, b) => Math.abs(a.value) - Math.abs(b.value));
  const lines: PitchforkLine[] = [];
  const fills: PitchforkShape['fills'] = [];
  if (hasDir) {
    const len = Math.hypot(d.x, d.y);
    const reach = (2 * (width + height) + Math.hypot(p3.x - m.x, p3.y - m.y) * Math.max(1, ...on.map((l) => Math.abs(l.value)))) / len;
    const at = (k: number): Pt => ({ x: m.x + k * (p3.x - m.x), y: m.y + k * (p3.y - m.y) });
    for (const side of [1, -1] as const) {
      let prev = 0;
      for (const l of on) {
        const q = at(side * Math.abs(l.value));
        const seg = clipLine(q, d, width, height, extend);
        if (seg) lines.push({ value: l.value, color: l.color, side, seg });
        const a = at(side * prev);
        const back = extend ? -reach : 0;
        const poly = clipPolygon(
          [
            { x: a.x + d.x * back, y: a.y + d.y * back },
            { x: a.x + d.x * reach, y: a.y + d.y * reach },
            { x: q.x + d.x * reach, y: q.y + d.y * reach },
            { x: q.x + d.x * back, y: q.y + d.y * back },
          ],
          width,
          height,
        );
        if (poly.length >= 3 && Math.abs(l.value) !== prev) fills.push({ color: l.color, poly });
        prev = Math.abs(l.value);
      }
    }
  }
  return { origin, median, handle: [p2, p3], lines, fills };
}

export { pointInPolygon };
