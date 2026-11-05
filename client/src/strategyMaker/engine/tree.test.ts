import { describe, expect, it } from 'vitest';
import { featuresUsed, importanceOf, leafRules, predictRow, rulesText, trainTree, type TreeNode } from './tree';

/** Feature 0 decides the class (long from 50 up, short below 10); feature 1 is a constant that cannot split. */
function data(): { columns: Float64Array[]; labels: Uint8Array } {
  const n = 100;
  const f0 = new Float64Array(n);
  const labels = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    f0[i] = i;
    labels[i] = i >= 50 ? 1 : i < 10 ? 2 : 0;
  }
  return { columns: [f0, new Float64Array(n).fill(7)], labels };
}

describe('tree', () => {
  it('finds the exact splits of a two-feature data set and predicts it', async () => {
    const { columns, labels } = data();
    const tree = await trainTree(columns, labels, { maxDepth: 3, minLeaf: 5 });
    const split = tree as Extract<TreeNode, { leaf: false }>;
    expect(split.leaf).toBe(false);
    expect(split.feature).toBe(0);
    for (let i = 0; i < 100; i++) expect(predictRow(tree, (f) => columns[f][i])).toBe(labels[i]);
    expect(featuresUsed(tree)).toEqual([0]);
    expect(importanceOf(tree, 2)).toEqual([1, 0]);
    const rules = rulesText(tree, (f) => `x${f}`, (_f, v) => String(v));
    expect(rules).toHaveLength(2);
    expect(rules.some((r) => /^long when x0 > 49\.5$/.test(r))).toBe(true);
    expect(rules.some((r) => /^short when x0 <= \d+(\.5)?$/.test(r))).toBe(true);
  });

  it('is deterministic and breaks ties by the lower feature index', async () => {
    const { columns, labels } = data();
    const twin = [columns[0], Float64Array.from(columns[0]), columns[1]];
    const a = await trainTree(twin, labels, { maxDepth: 3, minLeaf: 5 });
    const b = await trainTree(twin, labels, { maxDepth: 3, minLeaf: 5 });
    expect(a).toEqual(b);
    expect(featuresUsed(a)).toEqual([0]);
  });

  it('respects the depth limit and the minimum leaf size', async () => {
    const { columns, labels } = data();
    const stump = await trainTree(columns, labels, { maxDepth: 1, minLeaf: 5 });
    const depth = (n: TreeNode): number => (n.leaf ? 0 : 1 + Math.max(depth(n.left), depth(n.right)));
    expect(depth(stump)).toBe(1);
    const none = await trainTree(columns, labels, { maxDepth: 4, minLeaf: 80 });
    expect(none.leaf).toBe(true);
    expect(importanceOf(none, 2)).toEqual([0, 0]);
  });

  it('weights classes by inverse frequency, so a rare class is still found', async () => {
    // 3% of rows are long, all in the top tenth of the feature, where they are three in ten: an unweighted tree
    // calls that region flat, a weighted one long.
    const n = 1000;
    const f = new Float64Array(n);
    const labels = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      f[i] = i;
      labels[i] = i >= 900 && i % 10 < 3 ? 1 : 0;
    }
    const tree = await trainTree([f], labels, { maxDepth: 2, minLeaf: 20 });
    expect(predictRow(tree, () => 950)).toBe(1);
    expect(predictRow(tree, () => 100)).toBe(0);
  });

  it('merges conditions on one feature and sums importance to 1', () => {
    const tree: TreeNode = {
      leaf: false,
      feature: 0,
      threshold: 1,
      gain: 0.3,
      left: { leaf: true, state: 0 },
      right: {
        leaf: false,
        feature: 0,
        threshold: 5,
        gain: 0.1,
        left: { leaf: false, feature: 1, threshold: 2, gain: 0.1, left: { leaf: true, state: 1 }, right: { leaf: true, state: 0 } },
        right: { leaf: true, state: 2 },
      },
    };
    expect(leafRules(tree)).toEqual([
      { state: 1, conditions: [{ feature: 0, above: 1, atMost: 5 }, { feature: 1, atMost: 2 }] },
      { state: 2, conditions: [{ feature: 0, above: 5 }] },
    ]);
    expect(rulesText(tree, (f) => `x${f}`, (_f, v) => String(v))).toEqual([
      'long when x0 > 1 and x0 <= 5 and x1 <= 2',
      'short when x0 > 5',
    ]);
    const imp = importanceOf(tree, 3);
    expect(imp).toEqual([0.8, 0.2, 0]);
    expect(imp.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
});
