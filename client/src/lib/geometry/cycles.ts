import type { Pt } from '../drawingGeometry';

/** The most repeats one cycle drawing makes, far above what any pane holds. */
export const MAX_CYCLES = 2000;

/**
 * The x of point 1 and of every whole multiple of the period `dx` from it, inside `[-margin, width + margin]`,
 * left to right. Empty for a zero or not finite period or width.
 */
export function cycleXs(x0: number, dx: number, width: number, margin: number): number[] {
  const p = Math.abs(dx);
  if (!Number.isFinite(x0) || !Number.isFinite(p) || p === 0 || !Number.isFinite(width)) return [];
  const lo = -margin;
  const hi = width + margin;
  const first = Math.ceil((lo - x0) / p);
  const last = Math.floor((hi - x0) / p);
  const xs: number[] = [];
  for (let k = first; k <= last && xs.length < MAX_CYCLES; k++) xs.push(x0 + k * p);
  return xs;
}

/** The spans `[from, to]` of the arcs one period wide (from point 1, both ways) that touch `[-margin, width + margin]`. */
export function cycleArcs(x0: number, dx: number, width: number, margin: number): { from: number; to: number }[] {
  const p = Math.abs(dx);
  if (!Number.isFinite(x0) || !Number.isFinite(p) || p === 0 || !Number.isFinite(width)) return [];
  const xs = cycleXs(x0, p, width, margin);
  if (xs.length === 0) return [];
  const spans = xs.map((x) => ({ from: x, to: x + p }));
  if (spans.length < MAX_CYCLES) spans.unshift({ from: xs[0] - p, to: xs[0] });
  return spans.filter((s) => s.to > -margin && s.from <= width + margin);
}

/** Points along the elliptical half arc over `[from, to]` on the line y = baseY, bulging by `height` (signed, pixels). */
export function arcPoints(from: number, to: number, baseY: number, height: number, segments = 32): Pt[] {
  const cx = (from + to) / 2;
  const rx = (to - from) / 2;
  const pts: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const a = Math.PI * (i / segments);
    pts.push({ x: cx - rx * Math.cos(a), y: baseY + height * Math.sin(a) });
  }
  return pts;
}

/**
 * Samples of the sine wave with an extreme at p0 and the opposite extreme at p1 (half a period apart), at every
 * `step` pixels across `[0, width]` and at both points. Empty when the points share an x.
 */
export function sinePoints(p0: Pt, p1: Pt, width: number, step: number): Pt[] {
  const half = p1.x - p0.x;
  if (!Number.isFinite(half) || half === 0 || !Number.isFinite(p0.y) || !Number.isFinite(p1.y) || !(step > 0) || !(width >= 0)) return [];
  const mid = (p0.y + p1.y) / 2;
  const amp = (p1.y - p0.y) / 2;
  const yAt = (x: number) => mid - amp * Math.cos((Math.PI * (x - p0.x)) / half);
  const xs = new Set<number>();
  const n = Math.min(Math.ceil(width / step), MAX_CYCLES * 4);
  for (let i = 0; i <= n; i++) xs.add(Math.min(width, (i * width) / Math.max(n, 1)));
  for (const x of [p0.x, p1.x]) if (x >= 0 && x <= width) xs.add(x);
  return [...xs].sort((a, b) => a - b).map((x) => ({ x, y: yAt(x) }));
}
