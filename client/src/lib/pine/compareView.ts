import type { Extension } from '@codemirror/state';

/** The diff library, loaded on first use so it stays out of the chart app's main bundle. */
export type MergeLib = typeof import('@codemirror/merge');

/** The unified diff of a compared pane against `original`: only what differs, unchanged runs folded, small edits shown inside their line. */
export function compareExtension(lib: MergeLib, original: string): Extension {
  return lib.unifiedMergeView({
    original,
    mergeControls: false,
    highlightChanges: true,
    gutter: true,
    syntaxHighlightDeletions: true,
    allowInlineDiffs: true,
    collapseUnchanged: { margin: 3, minSize: 4 },
  });
}

/**
 * The smallest single change that turns `cur` into `want` (common prefix and suffix trimmed), or null when equal.
 * Feeding the diff this instead of a whole-document replacement lets it re-diff only the edited region and keep the rest.
 */
export function originalChange(cur: string, want: string): { from: number; to: number; insert: string } | null {
  if (cur === want) return null;
  const max = Math.min(cur.length, want.length);
  let start = 0;
  while (start < max && cur.charCodeAt(start) === want.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && cur.charCodeAt(cur.length - 1 - end) === want.charCodeAt(want.length - 1 - end)) end++;
  return { from: start, to: cur.length - end, insert: want.slice(start, want.length - end) };
}
