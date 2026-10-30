import { mulberry32 } from '../random.ts';

/** The most points a Ghost feed takes; reaching it ends placement (the same as a path). */
export const GHOST_FEED_MAX_POINTS = 100;

export type GhostBar = { slot: number; open: number; high: number; low: number; close: number };

/** A 32-bit hash (FNV-1a) of numbers, by their exact bits. */
function hashNumbers(values: readonly number[]): number {
  const view = new DataView(new ArrayBuffer(8));
  let h = 0x811c9dc5;
  for (const v of values) {
    view.setFloat64(0, v);
    for (let i = 0; i < 8; i++) h = Math.imul(h ^ view.getUint8(i), 0x01000193);
  }
  return h >>> 0;
}

/**
 * The bars a Ghost feed draws: between each pair of consecutive anchors one bar per whole bar slot (`slotOf` gives an
 * anchor time's slot, rounded to a whole one), none for a segment of zero slots. A segment's first bar opens at the
 * first anchor's price, each bar opens at the previous close and the closes step along the straight line to the second
 * anchor's price. A bar's range is `avgHeight` scaled by up to `variance` percent either way (never less than its
 * body); the spare range is split between the wicks. All randomness is a mulberry32 seeded from the segment's two
 * anchors and its index, so the same anchors and settings give the same bars on every call and moving one anchor
 * changes only its two segments. Never throws.
 */
export function ghostFeedBars(
  anchors: readonly { time: number; price: number }[],
  slotOf: (time: number) => number,
  { avgHeight, variance }: { avgHeight: number; variance: number },
): GhostBar[] {
  const out: GhostBar[] = [];
  const spread = Math.min(1, Math.max(0, variance / 100));
  const avg = Number.isFinite(avgHeight) ? Math.max(0, avgHeight) : 0;
  for (let i = 0; i + 1 < anchors.length; i++) {
    const a = anchors[i];
    const b = anchors[i + 1];
    if (![a.time, a.price, b.time, b.price].every(Number.isFinite)) continue;
    const sa = Math.round(slotOf(a.time));
    const sb = Math.round(slotOf(b.time));
    const n = Math.abs(sb - sa);
    const dir = sb >= sa ? 1 : -1;
    const rand = mulberry32(hashNumbers([a.time, a.price, b.time, b.price, i]));
    let open = a.price;
    for (let k = 1; k <= n; k++) {
      const close = a.price + ((b.price - a.price) * k) / n;
      const body = Math.abs(close - open);
      const range = Math.max(body, avg * (1 + spread * (2 * rand() - 1)));
      const spare = range - body;
      const up = spare * rand();
      out.push({ slot: sa + dir * k, open, high: Math.max(open, close) + up, low: Math.min(open, close) - (spare - up), close });
      open = close;
    }
  }
  return out;
}
