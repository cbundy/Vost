/**
 * The chart layouts: the 55 arrangements of 1 to 16 charts (as in docs/reference/layouts/picker.png), the saved
 * layout (`layout.v1`) with its sanitizing parse, and the track-size helpers the grid's dividers use.
 * Pure: no React, no storage.
 */

/** One chart's place in the grid, in grid tracks (0-based). */
export interface Cell {
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

export interface Arrangement {
  /** Stable: saved in `layout.v1`. */
  id: string;
  /** Number of charts. */
  count: number;
  /** Column and row track counts of the grid. */
  cols: number;
  rows: number;
  /** One cell per chart, in reading order (top-left first). */
  cells: Cell[];
  /** Accessible name, for example "4 charts: 1 large left, 3 stacked right". */
  label: string;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const lcm = (a: number, b: number): number => (a / gcd(a, b)) * b;

const inReadingOrder = (cells: Cell[]): Cell[] => [...cells].sort((a, b) => a.row - b.row || a.col - b.col);

/** Rows of `counts[i]` equal cells each, top to bottom; the rows share a grid as fine as their common multiple. */
function bands(counts: number[]): Pick<Arrangement, 'cols' | 'rows' | 'cells'> {
  const cols = counts.reduce(lcm, 1);
  const cells: Cell[] = [];
  counts.forEach((n, row) => {
    for (let i = 0; i < n; i++) cells.push({ col: (i * cols) / n, row, colSpan: cols / n, rowSpan: 1 });
  });
  return { cols, rows: counts.length, cells: inReadingOrder(cells) };
}

/** Columns of `counts[i]` equal cells each, left to right: the transpose of {@link bands}. */
function stacks(counts: number[]): Pick<Arrangement, 'cols' | 'rows' | 'cells'> {
  const rows = counts.reduce(lcm, 1);
  const cells: Cell[] = [];
  counts.forEach((n, col) => {
    for (let i = 0; i < n; i++) cells.push({ col, row: (i * rows) / n, colSpan: 1, rowSpan: rows / n });
  });
  return { cols: counts.length, rows, cells: inReadingOrder(cells) };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const charts = (n: number) => (n === 1 ? '1 chart' : `${n} charts`);

function describeBands(counts: number[]): string {
  const n = charts(sum(counts));
  if (counts.length === 2 && counts[0] === 1) return `${n}: 1 wide on top, ${counts[1]} below`;
  if (counts.length === 2 && counts[1] === 1) return `${n}: ${counts[0]} on top, 1 wide below`;
  return `${n}: rows of ${counts.join(', ')}`;
}

function describeStacks(counts: number[]): string {
  const n = charts(sum(counts));
  if (counts.length === 2 && counts[0] === 1) return `${n}: 1 large left, ${counts[1]} stacked right`;
  if (counts.length === 2 && counts[1] === 1) return `${n}: ${counts[0]} stacked left, 1 large right`;
  return `${n}: columns of ${counts.join(', ')}`;
}

const make = (id: string, label: string, shape: Pick<Arrangement, 'cols' | 'rows' | 'cells'>): Arrangement => ({
  id,
  count: shape.cells.length,
  label,
  ...shape,
});

const single = (): Arrangement => make('single', '1 chart', bands([1]));
const cols = (n: number): Arrangement => make(`cols-${n}`, `${charts(n)} side by side`, bands([n]));
const rows = (n: number): Arrangement => make(`rows-${n}`, `${charts(n)} stacked`, stacks([n]));
const grid = (c: number, r: number): Arrangement =>
  make(`grid-${c}x${r}`, `${charts(c * r)}: ${c} columns by ${r} rows`, bands(Array<number>(r).fill(c)));
const rowBands = (...counts: number[]): Arrangement => make(`bands-${counts.join('-')}`, describeBands(counts), bands(counts));
const colStacks = (...counts: number[]): Arrangement => make(`stacks-${counts.join('-')}`, describeStacks(counts), stacks(counts));

/** The picker's arrangements, in the picker's order (grouped by chart count). */
export const ARRANGEMENTS: readonly Arrangement[] = [
  single(),
  cols(2), rows(2),
  cols(3), rows(3), colStacks(1, 2), colStacks(2, 1), rowBands(2, 1), rowBands(1, 2),
  grid(2, 2), rows(4), cols(4), colStacks(1, 3), colStacks(3, 1), rowBands(1, 3), rowBands(3, 1), colStacks(1, 1, 2), colStacks(2, 1, 1), rowBands(2, 1, 1),
  rowBands(1, 4), cols(5), rows(5), colStacks(1, 4), colStacks(4, 1), rowBands(2, 3), rowBands(3, 2), rowBands(4, 1), colStacks(1, 1, 3), colStacks(3, 1, 1),
  grid(3, 2), cols(6), rows(6), grid(2, 3), rowBands(2, 4), rowBands(4, 2),
  rowBands(4, 3), cols(7), colStacks(1, 6),
  grid(4, 2), grid(2, 4), cols(8), rows(8),
  grid(3, 3), rowBands(5, 4), cols(9), rows(9),
  grid(5, 2), cols(10), rows(10),
  grid(6, 2), grid(3, 4), cols(12),
  grid(7, 2),
  grid(8, 2), grid(4, 4),
];

/** The chart counts the picker offers, in order. */
export const LAYOUT_COUNTS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16];

export const MAX_CHARTS = 16;
export const DEFAULT_ARRANGEMENT_ID = 'single';

const byId = new Map(ARRANGEMENTS.map((a) => [a.id, a]));

export function getArrangement(id: unknown): Arrangement | undefined {
  return typeof id === 'string' ? byId.get(id) : undefined;
}

export function arrangementsWithCount(count: number): Arrangement[] {
  return ARRANGEMENTS.filter((a) => a.count === count);
}

/* ------------------------------ track sizes ------------------------------ */

/** Each track's share of the grid's width (cols) and height (rows); both sum to 1. */
export interface LayoutSizes {
  cols: number[];
  rows: number[];
}

/** Smallest cell the dividers leave, in px; the grid clamps it when the area is too small for it. */
export const MIN_CELL_WIDTH = 120;
export const MIN_CELL_HEIGHT = 80;

const evenTracks = (n: number): number[] => Array.from({ length: n }, () => 1 / n);

export function evenSizes(a: Arrangement): LayoutSizes {
  return { cols: evenTracks(a.cols), rows: evenTracks(a.rows) };
}

function sanitizeTracks(raw: unknown, n: number): number[] | null {
  if (!Array.isArray(raw) || raw.length !== n) return null;
  let total = 0;
  for (const v of raw) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
    total += v;
  }
  if (!(total > 0)) return null;
  const out = (raw as number[]).map((v) => v / total);
  return out.every((v) => v >= MIN_TRACK_FRACTION / 2) ? out : null;
}

/** Tracks never shrink below this share, so a divider cannot make a cell vanish. */
const MIN_TRACK_FRACTION = 0.004;

/** Sizes that fit the arrangement; any bad axis falls back to even tracks. */
export function sanitizeSizes(raw: unknown, a: Arrangement): LayoutSizes {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return { cols: sanitizeTracks(r.cols, a.cols) ?? evenTracks(a.cols), rows: sanitizeTracks(r.rows, a.rows) ?? evenTracks(a.rows) };
}

export type Axis = 'col' | 'row';

/** A draggable edge between cells: the boundary before track `at`, over the other axis' tracks [from, to). */
export interface Divider {
  axis: Axis;
  at: number;
  from: number;
  to: number;
}

/** Every edge shared by two cells, with touching pieces on one line merged. */
export function dividers(a: Arrangement): Divider[] {
  const out: Divider[] = [];
  for (const axis of ['col', 'row'] as const) {
    const pieces = new Map<number, Array<[number, number]>>();
    for (const c of a.cells) {
      const at = axis === 'col' ? c.col + c.colSpan : c.row + c.rowSpan;
      if (at >= (axis === 'col' ? a.cols : a.rows)) continue;
      const from = axis === 'col' ? c.row : c.col;
      const to = from + (axis === 'col' ? c.rowSpan : c.colSpan);
      pieces.set(at, [...(pieces.get(at) ?? []), [from, to]]);
    }
    for (const [at, list] of [...pieces].sort((x, y) => x[0] - y[0])) {
      list.sort((x, y) => x[0] - y[0]);
      let cur = list[0];
      for (const p of list.slice(1)) {
        if (p[0] <= cur[1]) cur = [cur[0], Math.max(cur[1], p[1])];
        else {
          out.push({ axis, at, from: cur[0], to: cur[1] });
          cur = p;
        }
      }
      out.push({ axis, at, from: cur[0], to: cur[1] });
    }
  }
  return out;
}

/** Where track `i` starts, as a share of the axis. */
export function trackStart(tracks: number[], i: number): number {
  let s = 0;
  for (let k = 0; k < i; k++) s += tracks[k];
  return s;
}

/**
 * How far the boundary before track `at` may move (as shares of the axis): every cell keeps `minShare` (or half
 * its even share when the area is too small for that) and no track collapses.
 */
export function boundaryLimits(a: Arrangement, axis: Axis, tracks: number[], at: number, minShare: number): { lo: number; hi: number } {
  const n = tracks.length;
  const here = trackStart(tracks, at);
  let lo = trackStart(tracks, at - 1) + MIN_TRACK_FRACTION;
  let hi = trackStart(tracks, at + 1) - MIN_TRACK_FRACTION;
  for (const c of a.cells) {
    const start = axis === 'col' ? c.col : c.row;
    const span = axis === 'col' ? c.colSpan : c.rowSpan;
    const min = Math.min(minShare, (0.5 * span) / n);
    if (start + span === at) lo = Math.max(lo, trackStart(tracks, start) + min);
    if (start === at) hi = Math.min(hi, trackStart(tracks, start + span) - min);
  }
  return lo <= hi ? { lo, hi } : { lo: here, hi: here };
}

/** Moves the boundary before track `at` to `share` (clamped to its limits), keeping the two tracks' total. */
export function moveBoundary(a: Arrangement, axis: Axis, tracks: number[], at: number, share: number, minShare: number): number[] {
  const { lo, hi } = boundaryLimits(a, axis, tracks, at, minShare);
  const q = Math.min(hi, Math.max(lo, share));
  const next = [...tracks];
  const before = trackStart(tracks, at - 1);
  const after = trackStart(tracks, at + 1);
  next[at - 1] = q - before;
  next[at] = after - q;
  return next;
}

/* ------------------------------ saved layout ------------------------------ */

export const LAYOUT_KEY = 'layout.v1';
export const LAYOUT_VERSION = 1;

/** Which things a change on one chart carries to every chart of the layout. */
export interface LayoutSync {
  symbol: boolean;
  interval: boolean;
  crosshair: boolean;
  time: boolean;
  dateRange: boolean;
}

export const SYNC_KEYS = ['symbol', 'interval', 'crosshair', 'time', 'dateRange'] as const satisfies ReadonlyArray<keyof LayoutSync>;

export const DEFAULT_SYNC: LayoutSync = { symbol: false, interval: false, crosshair: true, time: false, dateRange: false };

/** Reads saved sync flags field by field; a missing or non-boolean field takes its default. */
export function sanitizeSync(raw: unknown): LayoutSync {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_SYNC };
  for (const k of SYNC_KEYS) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
  return out;
}

/** What a valid saved layout holds; the per-chart records are checked field by field by the caller. */
export interface ParsedLayout {
  arrangement: Arrangement;
  activeChartId: string;
  charts: Array<Record<string, unknown>>;
  sizes: LayoutSizes;
  sync: LayoutSync;
}

/**
 * Reads a stored layout. Anything unusable - another version, an unknown arrangement, a chart count that does
 * not match it, charts without unique ids - gives null (the caller opens one chart); bad sizes alone fall back
 * to even tracks and an unknown active chart to the first.
 */
export function parseLayout(raw: unknown): ParsedLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== LAYOUT_VERSION) return null;
  const arrangement = getArrangement(r.arrangementId);
  if (!arrangement || !Array.isArray(r.charts) || r.charts.length !== arrangement.count) return null;
  const seen = new Set<string>();
  const charts: Array<Record<string, unknown>> = [];
  for (const c of r.charts) {
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    const id = (c as Record<string, unknown>).id;
    if (typeof id !== 'string' || !id || seen.has(id)) return null;
    seen.add(id);
    charts.push(c as Record<string, unknown>);
  }
  const activeChartId = typeof r.activeChartId === 'string' && seen.has(r.activeChartId) ? r.activeChartId : (charts[0].id as string);
  return { arrangement, activeChartId, charts, sizes: sanitizeSizes(r.sizes, arrangement), sync: sanitizeSync(r.sync) };
}
