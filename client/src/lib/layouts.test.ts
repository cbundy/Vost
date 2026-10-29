import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SYNC,
  sanitizeSync,
  ARRANGEMENTS,
  type Arrangement,
  LAYOUT_COUNTS,
  LAYOUT_VERSION,
  boundaryLimits,
  dividers,
  evenSizes,
  getArrangement,
  moveBoundary,
  parseLayout,
  sanitizeSizes,
  trackStart,
} from './layouts';

/** What is wrong with how an arrangement's cells cover its grid (empty when they tile it exactly). */
function tilingProblems(a: Arrangement): string[] {
  const owner: number[] = Array(a.cols * a.rows).fill(0);
  const problems = new Set<string>();
  for (const c of a.cells) {
    if (c.colSpan < 1 || c.rowSpan < 1 || c.col < 0 || c.row < 0 || c.col + c.colSpan > a.cols || c.row + c.rowSpan > a.rows) problems.add('outside');
    for (let r = c.row; r < c.row + c.rowSpan; r++) for (let k = c.col; k < c.col + c.colSpan; k++) if (r < a.rows && k < a.cols) owner[r * a.cols + k]++;
  }
  if (owner.some((n) => n === 0)) problems.add('gap');
  if (owner.some((n) => n > 1)) problems.add('overlap');
  return [...problems];
}

describe('the arrangements', () => {
  it('has 55 of them with the picker row counts', () => {
    expect(ARRANGEMENTS).toHaveLength(55);
    const per = LAYOUT_COUNTS.map((n) => ARRANGEMENTS.filter((a) => a.count === n).length);
    expect(LAYOUT_COUNTS).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16]);
    expect(per).toEqual([1, 2, 6, 10, 10, 6, 3, 4, 4, 3, 3, 1, 2]);
    expect(ARRANGEMENTS.every((a) => LAYOUT_COUNTS.includes(a.count))).toBe(true);
  });

  it('is listed in the picker order: grouped by count, ascending', () => {
    const counts = ARRANGEMENTS.map((a) => a.count);
    expect(counts).toEqual([...counts].sort((a, b) => a - b));
  });

  it('has unique ids and labels', () => {
    expect(new Set(ARRANGEMENTS.map((a) => a.id)).size).toBe(55);
    expect(new Set(ARRANGEMENTS.map((a) => a.label)).size).toBe(55);
  });

  it.each(ARRANGEMENTS.map((a) => [a.id, a] as const))('%s: cells tile the grid exactly and match the chart count', (_id, a) => {
    expect(a.cells).toHaveLength(a.count);
    expect(tilingProblems(a)).toEqual([]);
  });

  it('the tiling check catches a gap, an overlap and a cell outside the grid', () => {
    const two = getArrangement('cols-2')!;
    expect(tilingProblems({ ...two, cells: [two.cells[0]] })).toEqual(['gap']);
    expect(tilingProblems({ ...two, cells: [two.cells[0], two.cells[0], two.cells[1]] })).toEqual(['overlap']);
    expect(tilingProblems({ ...two, cells: [two.cells[0], { ...two.cells[1], colSpan: 2 }] })).toContain('outside');
  });

  it.each(ARRANGEMENTS.map((a) => [a.id, a] as const))('%s: cells are in reading order', (_id, a) => {
    const keys = a.cells.map((c) => c.row * 1000 + c.col);
    expect(keys).toEqual([...keys].sort((x, y) => x - y));
  });

  it('describes a large chart beside a stack the way the picker names it', () => {
    expect(getArrangement('stacks-1-3')?.label).toBe('4 charts: 1 large left, 3 stacked right');
    expect(getArrangement('stacks-1-3')?.cells).toEqual([
      { col: 0, row: 0, colSpan: 1, rowSpan: 3 },
      { col: 1, row: 0, colSpan: 1, rowSpan: 1 },
      { col: 1, row: 1, colSpan: 1, rowSpan: 1 },
      { col: 1, row: 2, colSpan: 1, rowSpan: 1 },
    ]);
  });

  it('finds an arrangement by id only when it is one', () => {
    expect(getArrangement('grid-2x2')?.count).toBe(4);
    expect(getArrangement('nope')).toBeUndefined();
    expect(getArrangement(4)).toBeUndefined();
  });
});

describe('dividers', () => {
  it('a 2x2 grid has one column and one row divider spanning the whole grid', () => {
    expect(dividers(getArrangement('grid-2x2')!)).toEqual([
      { axis: 'col', at: 1, from: 0, to: 2 },
      { axis: 'row', at: 1, from: 0, to: 2 },
    ]);
  });

  it('a large chart beside a stack has a column divider and two row dividers on the stack side only', () => {
    expect(dividers(getArrangement('stacks-1-3')!)).toEqual([
      { axis: 'col', at: 1, from: 0, to: 3 },
      { axis: 'row', at: 1, from: 1, to: 2 },
      { axis: 'row', at: 2, from: 1, to: 2 },
    ]);
  });

  it('every divider of every arrangement lies on a cell edge', () => {
    for (const a of ARRANGEMENTS) {
      for (const d of dividers(a)) {
        const edge = a.cells.some((c) => (d.axis === 'col' ? c.col + c.colSpan : c.row + c.rowSpan) === d.at);
        expect(edge).toBe(true);
      }
      expect(dividers(a).length > 0 || a.count === 1).toBe(true);
    }
  });
});

describe('track sizes', () => {
  const grid = getArrangement('grid-2x2')!;
  const stack = getArrangement('stacks-1-3')!;

  it('even tracks sum to 1', () => {
    const s = evenSizes(getArrangement('bands-5-4')!);
    expect(s.cols).toHaveLength(20);
    expect(s.cols.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(s.rows).toEqual([0.5, 0.5]);
  });

  it('sanitizeSizes keeps good sizes (normalised) and falls back to even tracks per axis for bad ones', () => {
    expect(sanitizeSizes({ cols: [0.25, 0.75], rows: [0.5, 0.5] }, grid)).toEqual({ cols: [0.25, 0.75], rows: [0.5, 0.5] });
    expect(sanitizeSizes({ cols: [1, 3], rows: [0.5, 0.5] }, grid).cols).toEqual([0.25, 0.75]);
    const even = evenSizes(grid);
    for (const bad of [null, 'x', 5, [], {}, { cols: [1], rows: [1] }, { cols: [0.5, -0.5], rows: [NaN, 1] }, { cols: [0, 1], rows: ['a', 'b'] }, { cols: [1e-9, 1], rows: [1, 1, 1] }]) {
      expect(sanitizeSizes(bad, grid)).toEqual(even);
    }
    expect(sanitizeSizes({ cols: [0.3, 0.7], rows: 'bad' }, grid)).toEqual({ cols: [0.3, 0.7], rows: [0.5, 0.5] });
  });

  it('moves a boundary, keeping the two tracks total and the sum at 1', () => {
    const next = moveBoundary(grid, 'col', [0.5, 0.5], 1, 0.7, 0.1);
    expect(next[0]).toBeCloseTo(0.7);
    expect(next[1]).toBeCloseTo(0.3);
  });

  it('keeps every cell at the minimum size', () => {
    const { lo, hi } = boundaryLimits(grid, 'col', [0.5, 0.5], 1, 0.2);
    expect(lo).toBeCloseTo(0.2);
    expect(hi).toBeCloseTo(0.8);
    const dragged = moveBoundary(grid, 'col', [0.5, 0.5], 1, 0.01, 0.2);
    expect(dragged[0]).toBeCloseTo(0.2);
    const tooFar = moveBoundary(grid, 'row', [0.5, 0.5], 1, 5, 0.2);
    expect(tooFar[0]).toBeCloseTo(0.8);
  });

  it('only the cells that end or start on the boundary limit it', () => {
    // 1 large + 3 stacked: moving the first row divider is limited by the first stacked cell and the second one.
    const rows = [1 / 3, 1 / 3, 1 / 3];
    const { lo, hi } = boundaryLimits(stack, 'row', rows, 1, 0.1);
    expect(lo).toBeCloseTo(0.1);
    expect(hi).toBeCloseTo(2 / 3 - 0.1);
    expect(trackStart(rows, 2)).toBeCloseTo(2 / 3);
  });

  it('shrinks the minimum when the area is too small for it, so an even layout still moves', () => {
    const { lo, hi } = boundaryLimits(grid, 'col', [0.5, 0.5], 1, 0.9);
    expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(0.5);
  });
});

describe('sanitizeSync', () => {
  it('defaults to crosshair only', () => {
    expect(sanitizeSync(undefined)).toEqual({ symbol: false, interval: false, crosshair: true, time: false, dateRange: false });
  });
  it('keeps booleans and falls back field by field', () => {
    expect(sanitizeSync({ symbol: true, crosshair: false, time: 'yes', interval: 1, extra: true })).toEqual({
      symbol: true,
      interval: false,
      crosshair: false,
      time: false,
      dateRange: false,
    });
    expect(sanitizeSync([])).toEqual(DEFAULT_SYNC);
  });
});

describe('parseLayout', () => {
  const chart = (id: string) => ({ id, providerId: 'demo', symbol: 'DEMO', timeframe: '1d', bars: 500 });
  const good = () => ({
    version: LAYOUT_VERSION,
    arrangementId: 'grid-2x2',
    activeChartId: 'b',
    charts: ['a', 'b', 'c', 'd'].map(chart),
    sizes: { cols: [0.4, 0.6], rows: [0.5, 0.5] },
  });

  it('reads a good layout', () => {
    const p = parseLayout(good())!;
    expect(p.arrangement.id).toBe('grid-2x2');
    expect(p.activeChartId).toBe('b');
    expect(p.charts.map((c) => c.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(p.sizes).toEqual({ cols: [0.4, 0.6], rows: [0.5, 0.5] });
  });

  it('falls back to nothing for corrupt, other-version, unknown or mismatched layouts', () => {
    expect(parseLayout(null)).toBeNull();
    expect(parseLayout('{')).toBeNull();
    expect(parseLayout([])).toBeNull();
    expect(parseLayout({ ...good(), version: 2 })).toBeNull();
    expect(parseLayout({ ...good(), arrangementId: 'nope' })).toBeNull();
    expect(parseLayout({ ...good(), charts: good().charts.slice(0, 3) })).toBeNull();
    expect(parseLayout({ ...good(), charts: [...good().charts.slice(0, 3), chart('a')] })).toBeNull();
    expect(parseLayout({ ...good(), charts: [...good().charts.slice(0, 3), 7] })).toBeNull();
    expect(parseLayout({ ...good(), charts: [...good().charts.slice(0, 3), { symbol: 'X' }] })).toBeNull();
  });

  it('keeps a good sync and defaults a missing, partial or bad one', () => {
    const sync = { symbol: true, interval: true, crosshair: false, time: true, dateRange: true };
    expect(parseLayout({ ...good(), sync })!.sync).toEqual(sync);
    expect(parseLayout(good())!.sync).toEqual(DEFAULT_SYNC);
    expect(parseLayout({ ...good(), sync: { time: true } })!.sync).toEqual({ ...DEFAULT_SYNC, time: true });
    const bad = parseLayout({ ...good(), sync: { symbol: 'x', crosshair: null } })!;
    expect(bad.sync).toEqual(DEFAULT_SYNC);
    expect(bad.sizes).toEqual({ cols: [0.4, 0.6], rows: [0.5, 0.5] });
  });

  it('bad sizes fall back to even tracks and an unknown active chart to the first', () => {
    const p = parseLayout({ ...good(), sizes: { cols: [1], rows: 'x' }, activeChartId: 'zzz' })!;
    expect(p.sizes).toEqual(evenSizes(p.arrangement));
    expect(p.activeChartId).toBe('a');
  });
});
