export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface Placement {
  left: number;
  top: number;
  width: number;
  below: boolean;
}

export const TIP_MARGIN = 8;
export const TIP_GAP = 6;

/** Place a tooltip below its anchor when it fits, else above, kept TIP_MARGIN inside the viewport. */
export function placeTip(anchor: Box, tip: { width: number; height: number }, viewport: { width: number; height: number }): Placement {
  const width = Math.min(tip.width, Math.max(0, viewport.width - 2 * TIP_MARGIN));
  const maxLeft = Math.max(TIP_MARGIN, viewport.width - TIP_MARGIN - width);
  const left = Math.min(Math.max(anchor.left, TIP_MARGIN), maxLeft);
  const belowTop = anchor.top + anchor.height + TIP_GAP;
  const fitsBelow = belowTop + tip.height <= viewport.height - TIP_MARGIN;
  if (fitsBelow) return { left, top: belowTop, width, below: true };
  const aboveTop = Math.max(TIP_MARGIN, anchor.top - TIP_GAP - tip.height);
  return { left, top: aboveTop, width, below: false };
}
