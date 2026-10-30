/** Pure geometry of a Pine fill() between two series: the polygons to paint. */
export interface FillBar {
  /** Horizontal pixel of the bar, null when it has none. */
  x: number | null;
  /** Pixel of each side, null for na. */
  y1: number | null;
  y2: number | null;
  /** Colour of the segment starting at this bar. */
  color: string;
}

export interface FillPolygon {
  color: string;
  /** Closed outline: the first side left to right, then the second side back. */
  points: { x: number; y: number }[];
}

/**
 * One polygon per run of consecutive drawable segments of one colour. The segment from bar i to i+1 takes bar i's
 * colour and is drawn only when both bars have an x and both sides there.
 */
export function fillPolygons(bars: readonly FillBar[]): FillPolygon[] {
  const out: FillPolygon[] = [];
  let run: { color: string; top: { x: number; y: number }[]; bottom: { x: number; y: number }[]; end: number } | null = null;
  const flush = () => {
    if (run) out.push({ color: run.color, points: [...run.top, ...run.bottom.reverse()] });
    run = null;
  };
  for (let i = 0; i + 1 < bars.length; i++) {
    const a = bars[i];
    const b = bars[i + 1];
    if (a.x === null || b.x === null || a.y1 === null || a.y2 === null || b.y1 === null || b.y2 === null) {
      flush();
      continue;
    }
    if (run && (run.color !== a.color || run.end !== i)) flush();
    if (!run) run = { color: a.color, top: [{ x: a.x, y: a.y1 }], bottom: [{ x: a.x, y: a.y2 }], end: i };
    run.top.push({ x: b.x, y: b.y1 });
    run.bottom.push({ x: b.x, y: b.y2 });
    run.end = i + 1;
  }
  flush();
  return out;
}
