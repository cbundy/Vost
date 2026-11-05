/**
 * A small decision tree over three classes (flat, long, short): weighted gini, 64 histogram bins per feature,
 * built level by level. Deterministic: ties go to the lower feature index, then the lower threshold.
 */

export type State = 0 | 1 | 2;
export const STATE_NAMES = ['flat', 'long', 'short'] as const;

export interface Leaf {
  leaf: true;
  state: State;
}
export interface Split {
  leaf: false;
  /** Index into the model's feature list. A row goes left when its value is at most `threshold`. */
  feature: number;
  threshold: number;
  /** Weighted impurity this split removed, as a share of the root's weight. */
  gain: number;
  left: TreeNode;
  right: TreeNode;
}
export type TreeNode = Leaf | Split;

export interface TreeOptions {
  maxDepth: number;
  /** Fewest rows in a leaf. */
  minLeaf: number;
}

export const BINS = 64;
const EPS = 1e-12;

/** Candidate thresholds of one column: midpoints between neighbouring distinct values at the 1/64 quantiles. */
function edgesOf(column: Float64Array): number[] {
  const sorted = Float64Array.from(column).sort();
  const n = sorted.length;
  const edges: number[] = [];
  for (let q = 1; q < BINS; q++) {
    const idx = Math.floor((q * n) / BINS);
    if (idx < 1 || idx >= n) continue;
    const a = sorted[idx - 1];
    const b = sorted[idx];
    if (a === b) continue;
    const mid = (a + b) / 2;
    if (edges.length === 0 || mid > edges[edges.length - 1]) edges.push(mid);
  }
  return edges;
}

/** Number of edges below `x`, so a row with `x <= edges[b]` is in a bin at most `b`. */
function binOf(edges: number[], x: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (edges[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const impurity = (c: number[]): number => {
  const w = c[0] + c[1] + c[2];
  return w > 0 ? w - (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]) / w : 0;
};

export interface TreeHooks {
  /** Called after each level; `done` of `total` levels. May await (the caller yields and checks for cancel). */
  level?: (done: number, total: number) => Promise<void>;
}

/** Trains on feature-major columns (every column the same length, no NaN) and a class per row. */
export async function trainTree(columns: Float64Array[], labels: Uint8Array, opts: TreeOptions, hooks: TreeHooks = {}): Promise<TreeNode> {
  const n = labels.length;
  const counts = [0, 0, 0];
  for (let i = 0; i < n; i++) counts[labels[i]]++;
  const present = counts.filter((c) => c > 0).length;
  // Inverse frequency: each present class carries the same total weight.
  const weight = counts.map((c) => (c > 0 ? n / (present * c) : 0));

  const edges = columns.map(edgesOf);
  const bins = columns.map((col, f) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = binOf(edges[f], col[i]);
    return out;
  });

  const weighted = (rows: Int32Array): number[] => {
    const c = [0, 0, 0];
    for (let r = 0; r < rows.length; r++) c[labels[rows[r]]] += weight[labels[rows[r]]];
    return c;
  };
  const stateOf = (c: number[]): State => (c[1] > c[0] + EPS && c[1] >= c[2] ? 1 : c[2] > c[0] + EPS && c[2] > c[1] ? 2 : 0);

  let root: TreeNode = { leaf: true, state: 0 };
  let level: Array<{ rows: Int32Array; set: (node: TreeNode) => void }> = [
    { rows: Int32Array.from({ length: n }, (_, i) => i), set: (node) => (root = node) },
  ];
  for (let depth = 0; level.length > 0; depth++) {
    const next: typeof level = [];
    for (const { rows, set } of level) {
      const total = weighted(rows);
      const leaf: Leaf = { leaf: true, state: stateOf(total) };
      const parentImpurity = impurity(total);
      if (depth >= opts.maxDepth || rows.length < 2 * opts.minLeaf || parentImpurity <= EPS) {
        set(leaf);
        continue;
      }
      let best: { feature: number; edge: number; gain: number } | null = null;
      for (let f = 0; f < columns.length; f++) {
        const e = edges[f];
        if (e.length === 0) continue;
        const hist = new Float64Array((e.length + 1) * 3);
        const rowsIn = new Int32Array(e.length + 1);
        const b = bins[f];
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r];
          hist[b[row] * 3 + labels[row]] += weight[labels[row]];
          rowsIn[b[row]]++;
        }
        const left = [0, 0, 0];
        let leftRows = 0;
        for (let k = 0; k < e.length; k++) {
          for (let c = 0; c < 3; c++) left[c] += hist[k * 3 + c];
          leftRows += rowsIn[k];
          if (leftRows < opts.minLeaf || rows.length - leftRows < opts.minLeaf) continue;
          const right = [total[0] - left[0], total[1] - left[1], total[2] - left[2]];
          const gain = parentImpurity - impurity(left) - impurity(right);
          if (gain > EPS && (best == null || gain > best.gain + EPS)) best = { feature: f, edge: k, gain };
        }
      }
      if (best == null) {
        set(leaf);
        continue;
      }
      const col = bins[best.feature];
      const leftRows: number[] = [];
      const rightRows: number[] = [];
      for (let r = 0; r < rows.length; r++) (col[rows[r]] <= best.edge ? leftRows : rightRows).push(rows[r]);
      const split: Split = {
        leaf: false,
        feature: best.feature,
        threshold: edges[best.feature][best.edge],
        gain: best.gain / n,
        left: leaf,
        right: leaf,
      };
      set(split);
      next.push({ rows: Int32Array.from(leftRows), set: (node) => (split.left = node) });
      next.push({ rows: Int32Array.from(rightRows), set: (node) => (split.right = node) });
    }
    level = next;
    await hooks.level?.(Math.min(depth + 1, opts.maxDepth + 1), opts.maxDepth + 1);
  }
  return root;
}

/** The state a row ends in. `value(feature)` gives the row's reading. */
export function predictRow(tree: TreeNode, value: (feature: number) => number): State {
  let node = tree;
  while (!node.leaf) node = value(node.feature) <= node.threshold ? node.left : node.right;
  return node.state;
}

/** Share of the tree's total impurity removal by each feature; sums to 1, or all zero for a tree with no split. */
export function importanceOf(tree: TreeNode, featureCount: number): number[] {
  const out = new Array<number>(featureCount).fill(0);
  const walk = (node: TreeNode): void => {
    if (node.leaf) return;
    out[node.feature] += node.gain;
    walk(node.left);
    walk(node.right);
  };
  walk(tree);
  const sum = out.reduce((a, b) => a + b, 0);
  return sum > 0 ? out.map((v) => v / sum) : out;
}

/** Features the tree reads. */
export function featuresUsed(tree: TreeNode): number[] {
  const used = new Set<number>();
  const walk = (node: TreeNode): void => {
    if (node.leaf) return;
    used.add(node.feature);
    walk(node.left);
    walk(node.right);
  };
  walk(tree);
  return [...used].sort((a, b) => a - b);
}

/** One rule per non-flat leaf, left to right: the conditions (merged per feature) that lead to it. */
export function leafRules(tree: TreeNode): Array<{ state: State; conditions: Array<{ feature: number; above?: number; atMost?: number }> }> {
  const out: ReturnType<typeof leafRules> = [];
  const walk = (node: TreeNode, bounds: Map<number, { above?: number; atMost?: number }>): void => {
    if (node.leaf) {
      if (node.state !== 0) out.push({ state: node.state, conditions: [...bounds].map(([feature, b]) => ({ feature, ...b })) });
      return;
    }
    const was = bounds.get(node.feature);
    bounds.set(node.feature, { ...was, atMost: Math.min(was?.atMost ?? Infinity, node.threshold) });
    walk(node.left, bounds);
    bounds.set(node.feature, { ...was, above: Math.max(was?.above ?? -Infinity, node.threshold) });
    walk(node.right, bounds);
    if (was) bounds.set(node.feature, was);
    else bounds.delete(node.feature);
  };
  walk(tree, new Map());
  return out;
}

/**
 * Readable rules, for example `long when SMA 8 / SMA 34 distance > 0.03%`. `name` and `show` say how a feature and
 * a threshold are written.
 */
export function rulesText(tree: TreeNode, name: (feature: number) => string, show: (feature: number, value: number) => string): string[] {
  return leafRules(tree).map(({ state, conditions }) => {
    const parts: string[] = [];
    for (const c of conditions) {
      if (c.above != null) parts.push(`${name(c.feature)} > ${show(c.feature, c.above)}`);
      if (c.atMost != null) parts.push(`${name(c.feature)} <= ${show(c.feature, c.atMost)}`);
    }
    return parts.length ? `${STATE_NAMES[state]} when ${parts.join(' and ')}` : `${STATE_NAMES[state]} on every bar`;
  });
}
