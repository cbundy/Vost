import type { FibLevel } from '../../../lib/drawingStyle';
import { theme } from '../../../lib/theme';

/** The levels of the style's table `key` that are on, ordered by value. */
export function enabledLevels(style: Readonly<Record<string, unknown>>, key = 'levels'): FibLevel[] {
  const all = style[key];
  return Array.isArray(all) ? (all as FibLevel[]).filter((l) => l.on).sort((a, b) => a.value - b.value) : [];
}

/**
 * A level's label: its ratio, its price, or both as "0.5 (150)". `price` is the formatted price; absent, the label is
 * the ratio alone.
 */
export function levelLabel(ratio: number, price: string | undefined, showLevel: boolean, showPrice: boolean): string {
  if (price === undefined || !showPrice) return `${ratio}`;
  return showLevel ? `${ratio} (${price})` : price;
}

/** Draws a level label in the muted text colour; the caller picks the anchor point and alignment. */
export function drawLevelLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign = 'left', baseline: CanvasTextBaseline = 'bottom'): void {
  ctx.font = '11px sans-serif';
  ctx.textBaseline = baseline;
  ctx.textAlign = align;
  ctx.fillStyle = theme.muted;
  ctx.fillText(text, x, y);
}
