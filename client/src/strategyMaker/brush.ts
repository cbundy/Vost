/** Pure brush logic of the strategy maker: strokes to trades, replace on overlap, erase, undo and redo. */

/** One marked trade, unix seconds. The same shape as the search engine's `HighlightTrade`. */
export interface HighlightTrade {
  side: 'long' | 'short';
  entryTime: number;
  exitTime: number;
}

/** The trades needed before a strategy can be recommended. */
export const MIN_TRADES = 30;

export type Side = HighlightTrade['side'];
export type Tool = { kind: 'brush'; side: Side } | { kind: 'eraser' };

/** Index of the first bar time at or after t (times is sorted ascending). */
function lowerBound(times: readonly number[], t: number): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Number of bars from entry to exit, both included. */
export function barCount(times: readonly number[], t: HighlightTrade): number {
  return lowerBound(times, t.exitTime + 1) - lowerBound(times, t.entryTime);
}

/** The bar-time span of a stroke from bar index a to bar index b (either order), clamped to the bars. */
export function strokeSpan(times: readonly number[], a: number, b: number): { from: number; to: number } | null {
  if (!times.length) return null;
  const last = times.length - 1;
  const lo = Math.max(0, Math.min(last, Math.min(a, b)));
  const hi = Math.max(0, Math.min(last, Math.max(a, b)));
  return { from: times[lo], to: times[hi] };
}

/** A brush stroke gives one trade, or null when it did not cross at least two bars. */
export function strokeTrade(times: readonly number[], a: number, b: number, side: Side): HighlightTrade | null {
  const s = strokeSpan(times, a, b);
  if (!s || s.from === s.to) return null;
  return { side, entryTime: s.from, exitTime: s.to };
}

const overlaps = (t: HighlightTrade, from: number, to: number): boolean => t.entryTime <= to && t.exitTime >= from;
const byEntry = (x: HighlightTrade, y: HighlightTrade): number => x.entryTime - y.entryTime;

/** Cuts the span out of every trade it touches; a remainder stays only when it still spans two bars. */
function cut(trades: readonly HighlightTrade[], times: readonly number[], from: number, to: number): HighlightTrade[] {
  const out: HighlightTrade[] = [];
  for (const t of trades) {
    if (!overlaps(t, from, to)) {
      out.push(t);
      continue;
    }
    if (t.entryTime < from) {
      const i = lowerBound(times, from) - 1;
      if (i >= 0) {
        const left = { ...t, exitTime: times[i] };
        if (barCount(times, left) >= 2) out.push(left);
      }
    }
    if (t.exitTime > to) {
      const i = lowerBound(times, to + 1);
      if (i < times.length) {
        const right = { ...t, entryTime: times[i] };
        if (barCount(times, right) >= 2) out.push(right);
      }
    }
  }
  return out;
}

/** Adds a trade; the parts of existing trades it covers are replaced, so trades never overlap. */
export function paint(trades: readonly HighlightTrade[], times: readonly number[], trade: HighlightTrade): HighlightTrade[] {
  return [...cut(trades, times, trade.entryTime, trade.exitTime), trade].sort(byEntry);
}

/** Removes every trade a stroke from bar index a to b touches. */
export function erase(trades: readonly HighlightTrade[], times: readonly number[], a: number, b: number): HighlightTrade[] {
  const s = strokeSpan(times, a, b);
  if (!s) return [...trades];
  return trades.filter((t) => !overlaps(t, s.from, s.to));
}

/** Applies a stroke of the tool; returns the same array when nothing changed. */
export function applyStroke(
  trades: readonly HighlightTrade[],
  times: readonly number[],
  tool: Tool,
  a: number,
  b: number,
): readonly HighlightTrade[] {
  if (tool.kind === 'eraser') {
    const next = erase(trades, times, a, b);
    return next.length === trades.length ? trades : next;
  }
  const t = strokeTrade(times, a, b, tool.side);
  return t ? paint(trades, times, t) : trades;
}

export interface History {
  past: readonly (readonly HighlightTrade[])[];
  present: readonly HighlightTrade[];
  future: readonly (readonly HighlightTrade[])[];
}

export const emptyHistory = (present: readonly HighlightTrade[] = []): History => ({ past: [], present, future: [] });

/** A new state: undo can return to the old one, and redo is cleared. Same state gives the same history. */
export function commit(h: History, next: readonly HighlightTrade[]): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present], present: next, future: [] };
}
export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}
export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}
