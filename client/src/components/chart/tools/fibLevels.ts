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

/**
 * Draws labels one by one and drops any whose text would leave the pane or print over one already drawn,
 * so crowded levels (a small box, many ratios) stay readable. Order matters: the first label wins.
 */
export function labelPlacer(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const drawn: { l: number; r: number; t: number; b: number }[] = [];
  return (text: string, x: number, y: number, align: CanvasTextAlign = 'left', baseline: CanvasTextBaseline = 'bottom'): void => {
    const w = ctx.measureText?.(text)?.width || text.length * 6;
    const h = 12;
    const l = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    const t = baseline === 'top' ? y : baseline === 'middle' ? y - h / 2 : y - h;
    const box = { l, r: l + w, t, b: t + h };
    if (box.l < 0 || box.r > width || box.t < 0 || box.b > height) return;
    if (drawn.some((d) => box.l < d.r + 2 && box.r + 2 > d.l && box.t < d.b && box.b > d.t)) return;
    drawn.push(box);
    drawLevelLabel(ctx, text, x, y, align, baseline);
  };
}
