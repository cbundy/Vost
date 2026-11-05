export interface HighLowBar {
  high: number;
  low: number;
}

export interface HighLow {
  high: number;
  highIndex: number;
  low: number;
  lowIndex: number;
}

/**
 * The highest high and lowest low of the bars on screen. A bar counts when its centre is inside the
 * logical range, so the window is [ceil(from), floor(to)] clamped to the bars. Ties take the first index.
 */
export function visibleHighLow(bars: readonly HighLowBar[], range: { from: number; to: number } | null | undefined): HighLow | null {
  if (!range || bars.length === 0) return null;
  const start = Math.max(0, Math.ceil(range.from));
  const end = Math.min(bars.length - 1, Math.floor(range.to));
  if (!(start <= end)) return null;
  let highIndex = start;
  let lowIndex = start;
  for (let i = start + 1; i <= end; i++) {
    if (bars[i].high > bars[highIndex].high) highIndex = i;
    if (bars[i].low < bars[lowIndex].low) lowIndex = i;
  }
  return { high: bars[highIndex].high, highIndex, low: bars[lowIndex].low, lowIndex };
}
