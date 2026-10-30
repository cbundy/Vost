/** Arrow-key movement through the picker's grid of buttons, from their on-screen boxes. Pure, no DOM. */

export type CellBox = { x: number; y: number; w: number; h: number };

/**
 * The index of the cell an arrow key moves to from `index`, or null for another key or when there is nowhere to go.
 * Left and right step to the neighbour in reading order; up and down go to the next row up or down, to the cell
 * nearest in horizontal position (rows may differ in length, and the Recent row sits above the main grid).
 */
export function gridStep(boxes: readonly CellBox[], index: number, key: string): number | null {
  const cur = boxes[index];
  if (!cur || boxes.length === 0) return null;
  if (key === 'ArrowLeft') return index > 0 ? index - 1 : null;
  if (key === 'ArrowRight') return index < boxes.length - 1 ? index + 1 : null;
  if (key === 'Home') return 0;
  if (key === 'End') return boxes.length - 1;
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null;
  const down = key === 'ArrowDown';
  const cy = cur.y + cur.h / 2;
  const cx = cur.x + cur.w / 2;
  let rowY: number | null = null;
  for (const b of boxes) {
    const y = b.y + b.h / 2;
    if (down ? y > cy + 1 : y < cy - 1) {
      if (rowY === null || (down ? y < rowY : y > rowY)) rowY = y;
    }
  }
  if (rowY === null) return null;
  let best: number | null = null;
  let bestDist = Infinity;
  boxes.forEach((b, i) => {
    if (Math.abs(b.y + b.h / 2 - rowY!) > 1) return;
    const dist = Math.abs(b.x + b.w / 2 - cx);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  });
  return best;
}
