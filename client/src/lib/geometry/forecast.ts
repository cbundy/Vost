import type { OhlcBar, Pt } from '../drawingGeometry';

export type ForecastVerdict = 'pending' | 'success' | 'failure';

/**
 * What the loaded bars say about a forecast from `source` to `target`. It is pending while no loaded bar has a time at
 * or after the target time. After that it succeeds when some bar after the source time and up to the target time
 * reached the target price (the high for an upward forecast, the low for a downward one), else it fails. A flat
 * forecast (the target price equals the source price) succeeds at once. Never throws.
 */
export function forecastVerdict(source: { time: number; price: number }, target: { time: number; price: number }, candles: readonly OhlcBar[]): ForecastVerdict {
  if (![source.time, source.price, target.time, target.price].every(Number.isFinite)) return 'pending';
  if (target.price === source.price) return 'success';
  if (!candles.some((c) => c.time >= target.time)) return 'pending';
  const up = target.price > source.price;
  for (const c of candles) {
    if (c.time <= source.time) continue;
    if (c.time > target.time) break;
    if (up ? c.high >= target.price : c.low <= target.price) return 'success';
  }
  return 'failure';
}

export type ProjectionGeometry = {
  /** The leg's length: the arc's radius. */
  radius: number;
  /** Angle (radians, canvas orientation) of the leg from point 1 to point 2. */
  legAngle: number;
  /** Angle of the projection from point 1 to point 3. */
  projAngle: number;
  /** Signed angle from the leg to the projection, the short way round, in (-PI, PI]. */
  sweep: number;
  /** Length of the projection as a percent of the leg's length. */
  percent: number;
};

/** The geometry of a projection from its pixel points, or null when the leg or the projection has no length. */
export function projectionGeometry(a: Pt, b: Pt, c: Pt): ProjectionGeometry | null {
  const radius = Math.hypot(b.x - a.x, b.y - a.y);
  const length = Math.hypot(c.x - a.x, c.y - a.y);
  if (!(radius > 0) || !(length > 0) || !Number.isFinite(radius + length)) return null;
  const legAngle = Math.atan2(b.y - a.y, b.x - a.x);
  const projAngle = Math.atan2(c.y - a.y, c.x - a.x);
  let sweep = projAngle - legAngle;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep <= -Math.PI) sweep += Math.PI * 2;
  return { radius, legAngle, projAngle, sweep, percent: (length / radius) * 100 };
}

const ARC_STEP = Math.PI / 36;

/** The wedge between the leg and the arc through to the projection's direction: the centre, then points along the arc. */
export function projectionWedge(a: Pt, g: ProjectionGeometry): Pt[] {
  const n = Math.max(1, Math.ceil(Math.abs(g.sweep) / ARC_STEP));
  const pts: Pt[] = [a];
  for (let i = 0; i <= n; i++) {
    const t = g.legAngle + (g.sweep * i) / n;
    pts.push({ x: a.x + Math.cos(t) * g.radius, y: a.y + Math.sin(t) * g.radius });
  }
  return pts;
}

/** Whether p is inside the wedge: within the radius of point 1 and between the leg and the projection's direction. */
export function inProjectionWedge(p: Pt, a: Pt, g: ProjectionGeometry): boolean {
  return Math.hypot(p.x - a.x, p.y - a.y) <= g.radius && angleWithinSweep(Math.atan2(p.y - a.y, p.x - a.x), g);
}

/** Whether a direction lies between the leg and the projection's direction (the arc's side). */
export function angleWithinSweep(angle: number, g: ProjectionGeometry): boolean {
  let d = angle - g.legAngle;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return g.sweep >= 0 ? d >= 0 && d <= g.sweep : d <= 0 && d >= g.sweep;
}

/** Distance from p to the arc (its two ends count, so a point beyond the sweep measures to the end). */
export function distToProjectionArc(p: Pt, a: Pt, g: ProjectionGeometry): number {
  const d = Math.hypot(p.x - a.x, p.y - a.y);
  if (angleWithinSweep(Math.atan2(p.y - a.y, p.x - a.x), g)) return Math.abs(d - g.radius);
  const end = (t: number) => Math.hypot(p.x - (a.x + Math.cos(t) * g.radius), p.y - (a.y + Math.sin(t) * g.radius));
  return Math.min(end(g.legAngle), end(g.legAngle + g.sweep));
}
