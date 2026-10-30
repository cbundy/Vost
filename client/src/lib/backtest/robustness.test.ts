import { describe, expect, it } from 'vitest';
import type { OptimizeRow, SweepParam } from './optimizer';
import { finiteBounds, robustnessScores } from './robustness';


const sweep = (key: string, n: number): SweepParam => ({ key, from: 0, to: n - 1, step: 1 });

/** Rows in grid order (first sweep outermost) from a flat list of values; `undefined` drops the row (a failed combination). */
function gridRows(sizes: number[], values: Array<number | null | undefined>): { rows: OptimizeRow[]; sweeps: SweepParam[] } {
  const sweeps = sizes.map((n, i) => sweep(`p${i}`, n));
  const rows: OptimizeRow[] = [];
  values.forEach((value, flat) => {
    if (value === undefined) return;
    const params: Record<string, number> = {};
    let rest = flat;
    for (let a = sizes.length - 1; a >= 0; a--) {
      params[`p${a}`] = rest % sizes[a];
      rest = Math.floor(rest / sizes[a]);
    }
    rows.push({ params, metrics: {} as OptimizeRow['metrics'], value });
  });
  return { rows, sweeps };
}

describe('robustnessScores: one parameter', () => {
  const { rows, sweeps } = gridRows([5], [1, 2, 3, 4, 10]);
  it('scores the end, the middle and the peak at radius 1', () => {
    const s = robustnessScores(rows, sweeps, 1);
    expect(s[0]).toEqual({ neighbourMean: 2, neighbourMin: 2, neighbourCount: 1, robustness: 1.5, capped: false });
    expect(s[2]).toEqual({ neighbourMean: 3, neighbourMin: 2, neighbourCount: 2, robustness: 3, capped: false });
    expect(s[4]).toEqual({ neighbourMean: 4, neighbourMin: 4, neighbourCount: 1, robustness: 7, capped: false });
  });
  it('widens the neighbourhood at radius 2', () => {
    const s = robustnessScores(rows, sweeps, 2)[2];
    expect(s.neighbourCount).toBe(4);
    expect(s.neighbourMean).toBe(4.25);
    expect(s.neighbourMin).toBe(1);
    expect(s.robustness).toBe(4);
  });
  it('gives a row alone in its grid no figures', () => {
    const one = gridRows([1], [5]);
    expect(robustnessScores(one.rows, one.sweeps, 1)[0]).toEqual({ neighbourMean: null, neighbourMin: null, neighbourCount: 0, robustness: null, capped: false });
  });
});

describe('robustnessScores: two parameters', () => {
  const { rows, sweeps } = gridRows([3, 3], [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  it('corner, edge and centre at radius 1', () => {
    const s = robustnessScores(rows, sweeps, 1);
    const corner = s[0];
    expect(corner.neighbourCount).toBe(3);
    expect(corner.neighbourMean).toBeCloseTo(11 / 3, 12);
    expect(corner.neighbourMin).toBe(2);
    expect(corner.robustness).toBe(3);
    const edge = s[1];
    expect(edge.neighbourCount).toBe(5);
    expect(edge.neighbourMean).toBeCloseTo(19 / 5, 12);
    expect(edge.neighbourMin).toBe(1);
    expect(edge.robustness).toBe(3.5);
    const centre = s[4];
    expect(centre.neighbourCount).toBe(8);
    expect(centre.neighbourMean).toBe(5);
    expect(centre.neighbourMin).toBe(1);
    expect(centre.robustness).toBe(5);
  });
  it('a corner at radius 2 sees every other row', () => {
    const c = robustnessScores(rows, sweeps, 2)[0];
    expect(c.neighbourCount).toBe(8);
    expect(c.neighbourMean).toBe(5.5);
    expect(c.neighbourMin).toBe(2);
    expect(c.robustness).toBe(5);
  });
  it('follows the order of the rows it is given', () => {
    const reversed = [...rows].reverse();
    const s = robustnessScores(reversed, sweeps, 1);
    expect(s[0].neighbourCount).toBe(3); // the corner holding 9
    expect(s[0].neighbourMin).toBe(5);
    expect(s[4].neighbourCount).toBe(8); // the centre holding 5
  });
  it('excludes a null-value row as a neighbour, and leaves its own robustness null', () => {
    const g = gridRows([3, 3], [1, 2, 3, 4, null, 6, 7, 8, 9]);
    const s = robustnessScores(g.rows, g.sweeps, 1);
    expect(s[0].neighbourCount).toBe(2);
    expect(s[0].neighbourMean).toBe(3);
    expect(s[0].neighbourMin).toBe(2);
    expect(s[0].robustness).toBeCloseTo(7 / 3, 12);
    expect(s[4].neighbourCount).toBe(8);
    expect(s[4].neighbourMean).toBe(5);
    expect(s[4].neighbourMin).toBe(1);
    expect(s[4].robustness).toBeNull();
  });
  it('excludes a failed (absent) combination', () => {
    const g = gridRows([3, 3], [1, 2, 3, 4, undefined, 6, 7, 8, 9]);
    const s = robustnessScores(g.rows, g.sweeps, 1);
    expect(s).toHaveLength(8);
    expect(s[0].neighbourCount).toBe(2);
    expect(s[0].neighbourMean).toBe(3);
    expect(s[4].neighbourCount).toBe(4); // value 6 at (1,2): neighbours 2,3,8,9 (centre absent)
    expect(s[4].neighbourMin).toBe(2);
  });
});

describe('robustnessScores: infinite values', () => {
  it('counts +Infinity as the largest finite value and -Infinity as the smallest, flagging the rows that used them', () => {
    const g = gridRows([5], [1, 2, Infinity, 4, -Infinity]);
    const s = robustnessScores(g.rows, g.sweeps, 1);
    // finite values are 1, 2, 4: +Infinity -> 4, -Infinity -> 1
    expect(s[1]).toEqual({ neighbourMean: 2.5, neighbourMin: 1, neighbourCount: 2, robustness: (1 + 2 + 4) / 3, capped: true });
    expect(s[2]).toEqual({ neighbourMean: 3, neighbourMin: 2, neighbourCount: 2, robustness: (2 + 4 + 4) / 3, capped: true });
    expect(s[0].capped).toBe(false);
    expect(s[4]).toEqual({ neighbourMean: 4, neighbourMin: 4, neighbourCount: 1, robustness: 2.5, capped: true });
    expect(finiteBounds(g.rows)).toEqual({ max: 4, min: 1 });
  });
  it('treats infinite values as missing when the grid has no finite value', () => {
    const g = gridRows([3], [Infinity, -Infinity, Infinity]);
    for (const s of robustnessScores(g.rows, g.sweeps, 1)) {
      expect(s).toEqual({ neighbourMean: null, neighbourMin: null, neighbourCount: 0, robustness: null, capped: false });
    }
    expect(finiteBounds(g.rows)).toBeNull();
  });
});

describe('robustnessScores: more dimensions', () => {
  it('the hypercube of three parameters: a corner has 7 neighbours, the centre 26', () => {
    const values = Array.from({ length: 27 }, () => 1);
    const g = gridRows([3, 3, 3], values);
    const s = robustnessScores(g.rows, g.sweeps, 1);
    expect(s[0].neighbourCount).toBe(7);
    expect(s[13].neighbourCount).toBe(26);
    expect(s[13].robustness).toBe(1);
  });
  it('matches a brute-force scan on a 4 x 3 x 5 grid with holes', () => {
    const sizes = [4, 3, 5];
    const values = Array.from({ length: 60 }, (_, i) => (i % 7 === 3 ? undefined : i % 11 === 5 ? null : ((i * 37) % 23) - 8));
    const g = gridRows(sizes, values);
    for (const radius of [1, 2, 3]) {
      const s = robustnessScores(g.rows, g.sweeps, radius);
      g.rows.forEach((r, i) => {
        const nb = g.rows.filter(
          (o, j) => j !== i && o.value != null && sizes.every((_, a) => Math.abs(o.params[`p${a}`] - r.params[`p${a}`]) <= radius),
        );
        const vals = nb.map((o) => o.value as number);
        expect(s[i].neighbourCount).toBe(vals.length);
        if (vals.length === 0) {
          expect(s[i].neighbourMean).toBeNull();
          return;
        }
        expect(s[i].neighbourMean).toBeCloseTo(vals.reduce((a, b) => a + b, 0) / vals.length, 9);
        expect(s[i].neighbourMin).toBe(Math.min(...vals));
        if (r.value == null) expect(s[i].robustness).toBeNull();
        else expect(s[i].robustness).toBeCloseTo((vals.reduce((a, b) => a + b, 0) + r.value) / (vals.length + 1), 9);
      });
    }
  });
  it('scores a 100,000-combination grid of 16 binary dimensions within the default test timeout', () => {
    // 3 x 2^15 = 98,304 combinations over 16 dimensions: a per-row scan of (2r+1)^16 cells would never finish.
    const sizes = [3, ...Array.from({ length: 15 }, () => 2)];
    const big = gridRows(sizes, Array.from({ length: 3 * 2 ** 15 }, (_, i) => i % 13));
    const s = robustnessScores(big.rows, big.sweeps, 3);
    expect(s).toHaveLength(98_304);
    // radius 3 covers every index on every axis, so each row sees all the others
    expect(s.every((x) => x.neighbourCount === 98_303)).toBe(true);
  });
});
