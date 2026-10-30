import type { Pt } from '../../../lib/drawingGeometry';
import type { ToolView } from './types';

/**
 * The pixel x of a logical bar index: the chart's own scale when the view has one, else interpolated (and extrapolated)
 * linearly through the pixel points that sit on known logical indexes. Null when neither is possible.
 */
export function xMapper(view: ToolView, known: readonly { logical: number; x: number }[]): (logical: number) => number | null {
  if (view.indexToX) return (l) => view.indexToX!(l);
  const a = known[0];
  const b = known.find((k) => k.logical !== a?.logical);
  if (!a || !b) return () => null;
  const per = (b.x - a.x) / (b.logical - a.logical);
  return (l) => a.x + (l - a.logical) * per;
}

/** One bar in pixels. */
export type PxBar = { x: number; w: number; open: number; high: number; low: number; close: number };

/** Draws bars as the display mode says: 'hl' high-low lines, 'oc' open-close bodies, 'open'|'high'|'low'|'close' as a line. */
export function drawBars(ctx: CanvasRenderingContext2D, bars: readonly PxBar[], mode: string, up: string, down: string): void {
  // Pixel y grows downward: a rising bar has its close at a smaller y than its open.
  const dirColor = (b: PxBar) => (b.close <= b.open ? up : down);
  if (mode === 'oc') {
    for (const b of bars) {
      ctx.fillStyle = dirColor(b);
      ctx.fillRect(b.x - b.w / 2, Math.min(b.open, b.close), b.w, Math.max(1, Math.abs(b.close - b.open)));
    }
    return;
  }
  if (mode === 'hl') {
    ctx.lineWidth = Math.max(1, Math.min(3, bars[0] ? bars[0].w / 3 : 1));
    for (const b of bars) {
      ctx.beginPath();
      ctx.moveTo(b.x, b.high);
      ctx.lineTo(b.x, b.low);
      ctx.strokeStyle = dirColor(b);
      ctx.stroke();
    }
    return;
  }
  if (bars.length === 0) return;
  const key = mode as 'open' | 'high' | 'low' | 'close';
  ctx.beginPath();
  bars.forEach((b, i) => (i === 0 ? ctx.moveTo(b.x, b[key]) : ctx.lineTo(b.x, b[key])));
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = up;
  ctx.stroke();
}

/** Whether p is on a bar's high-low line or body, within tolerance. */
export function onBar(b: PxBar, p: Pt, tolerance: number): boolean {
  return Math.abs(p.x - b.x) <= Math.max(tolerance, b.w / 2) && p.y >= b.high - tolerance && p.y <= b.low + tolerance;
}
