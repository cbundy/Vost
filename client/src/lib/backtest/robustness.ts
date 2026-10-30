/**
 * Robustness of optimizer results: each result is scored by how the results around it in the grid did,
 * so a lucky one-off peak stands out from a broad, steady area. Nothing is run again; the figures come
 * from the finished grid.
 */
import { paramValues, type OptimizeRow, type SweepParam } from './optimizer';

export interface RobustnessScore {
  /** Mean of the neighbours' values; null with no neighbours. */
  neighbourMean: number | null;
  /** Lowest neighbour value; null with no neighbours. */
  neighbourMin: number | null;
  /** How many neighbours have a value. */
  neighbourCount: number;
  /** Mean of the row's own value and its neighbours' values; null with no neighbours or no own value. */
  robustness: number | null;
  /** True when the row's own value or a neighbour's was an infinity replaced by a finite value. */
  capped: boolean;
}

/** The largest and smallest finite value among the rows (null when there is none). */
export function finiteBounds(rows: OptimizeRow[]): { max: number; min: number } | null {
  let max = -Infinity;
  let min = Infinity;
  for (const r of rows) {
    const v = r.value;
    if (v == null || !Number.isFinite(v)) continue;
    if (v > max) max = v;
    if (v < min) min = v;
  }
  return max < min ? null : { max, min };
}

/**
 * Scores every row by its neighbourhood. `scores[i]` belongs to `rows[i]`.
 *
 * A row sits at the index of each swept value in paramValues(sweep), in every swept dimension. Its
 * neighbours are all other rows whose index differs by at most `radius` in every dimension (a hypercube,
 * clipped at the grid's edges). Rows without a value (null or NaN) and failed combinations (absent rows)
 * are not neighbours.
 *
 * Infinite values: +Infinity counts as the largest finite value in the grid and -Infinity as the smallest.
 * `capped` is true when the row's own value or any neighbour's was replaced. When the grid has no finite
 * value, infinite values count as missing.
 *
 * Cost: the hypercube is summed one axis at a time over the dense grid, so it is combos x dimensions x
 * (2 x radius + 1), whatever the number of dimensions. The lowest value excluding the row itself keeps the
 * two lowest values of a window with where they came from.
 */
export function robustnessScores(rows: OptimizeRow[], sweeps: SweepParam[], radius: number): RobustnessScore[] {
  const sizes: number[] = [];
  const indexOf: Array<Map<number, number>> = [];
  for (const s of sweeps) {
    const vals = paramValues(s);
    sizes.push(vals.length);
    indexOf.push(new Map(vals.map((v, i) => [v, i])));
  }
  const strides = new Array<number>(sizes.length);
  let n = 1;
  for (let a = sizes.length - 1; a >= 0; a--) {
    strides[a] = n;
    n *= sizes[a];
  }

  const bounds = finiteBounds(rows);
  const cellOf = rows.map((r, i) => {
    let idx = 0;
    for (let a = 0; a < sweeps.length; a++) {
      const k = indexOf[a].get(r.params[sweeps[a].key]);
      if (k == null) return -1;
      idx += k * strides[a];
    }
    return idx;
  });

  // Dense grid: the usable value, whether there is one, and whether it was an infinity.
  let val = new Float64Array(n);
  let cnt = new Float64Array(n);
  let cap = new Float64Array(n);
  const seen = new Uint8Array(n);
  const selfVal = new Float64Array(n);
  const selfPresent = new Uint8Array(n);
  const selfCap = new Uint8Array(n);
  rows.forEach((r, i) => {
    const c = cellOf[i];
    if (c < 0 || seen[c]) return;
    seen[c] = 1;
    const v = r.value;
    if (v == null || Number.isNaN(v)) return;
    let use = v;
    let capped = false;
    if (!Number.isFinite(v)) {
      if (!bounds) return;
      use = v > 0 ? bounds.max : bounds.min;
      capped = true;
    }
    selfVal[c] = use;
    selfPresent[c] = 1;
    selfCap[c] = capped ? 1 : 0;
    val[c] = use;
    cnt[c] = 1;
    cap[c] = capped ? 1 : 0;
  });

  // Two lowest values of a window with the cell each came from (-1 when none).
  let m1 = new Float64Array(n);
  let p1 = new Int32Array(n);
  let m2 = new Float64Array(n);
  let p2 = new Int32Array(n);
  for (let c = 0; c < n; c++) {
    m1[c] = selfPresent[c] ? selfVal[c] : Infinity;
    p1[c] = selfPresent[c] ? c : -1;
    m2[c] = Infinity;
    p2[c] = -1;
  }

  for (let a = 0; a < sizes.length; a++) {
    const size = sizes[a];
    const stride = strides[a];
    const nVal = new Float64Array(n);
    const nCnt = new Float64Array(n);
    const nCap = new Float64Array(n);
    const nM1 = new Float64Array(n);
    const nP1 = new Int32Array(n);
    const nM2 = new Float64Array(n);
    const nP2 = new Int32Array(n);
    for (let c = 0; c < n; c++) {
      const pos = Math.floor(c / stride) % size;
      const lo = Math.max(0, pos - radius);
      const hi = Math.min(size - 1, pos + radius);
      let s = 0;
      let k = 0;
      let kc = 0;
      let a1 = Infinity;
      let b1 = -1;
      let a2 = Infinity;
      let b2 = -1;
      for (let q = lo; q <= hi; q++) {
        const src = c + (q - pos) * stride;
        s += val[src];
        k += cnt[src];
        kc += cap[src];
        for (let t = 0; t < 2; t++) {
          const v = t === 0 ? m1[src] : m2[src];
          const o = t === 0 ? p1[src] : p2[src];
          if (o < 0) continue;
          if (v < a1) {
            a2 = a1;
            b2 = b1;
            a1 = v;
            b1 = o;
          } else if (v < a2) {
            a2 = v;
            b2 = o;
          }
        }
      }
      nVal[c] = s;
      nCnt[c] = k;
      nCap[c] = kc;
      nM1[c] = a1;
      nP1[c] = b1;
      nM2[c] = a2;
      nP2[c] = b2;
    }
    val = nVal;
    cnt = nCnt;
    cap = nCap;
    m1 = nM1;
    p1 = nP1;
    m2 = nM2;
    p2 = nP2;
  }

  return rows.map((_, i) => {
    const c = cellOf[i];
    if (c < 0) return { neighbourMean: null, neighbourMin: null, neighbourCount: 0, robustness: null, capped: false };
    const own = selfPresent[c] === 1;
    const count = cnt[c] - (own ? 1 : 0);
    if (count <= 0) return { neighbourMean: null, neighbourMin: null, neighbourCount: 0, robustness: null, capped: own && selfCap[c] === 1 };
    const sum = val[c] - (own ? selfVal[c] : 0);
    const min = own && p1[c] === c ? m2[c] : m1[c];
    const cappedCount = cap[c] - (own ? selfCap[c] : 0);
    return {
      neighbourMean: sum / count,
      neighbourMin: min,
      neighbourCount: count,
      robustness: own ? val[c] / (count + 1) : null,
      capped: cappedCount > 0 || (own && selfCap[c] === 1),
    };
  });
}
