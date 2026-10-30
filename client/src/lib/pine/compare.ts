import { Text } from '@codemirror/state';
import { Chunk } from '@codemirror/merge';
import { loadJson, saveJson } from '../storage';
import { pineSourceTitle } from './title';

export interface CompareSummary {
  identical: boolean;
  /** Number of separate changed regions. */
  differences: number;
  /** Lines of the text that are new or changed. */
  added: number;
  /** Lines of the reference that are gone or changed. */
  removed: number;
  /** True when the diff hit its limit and may not be minimal. */
  approximate: boolean;
}

function spanLines(doc: Text, from: number, to: number): number {
  if (to <= from) return 0;
  return doc.lineAt(to - 1).number - doc.lineAt(from).number + 1;
}

/** Compares two texts exactly as written (a trailing newline or whitespace counts). Uses the same scan limit (500) as the merge view, so the summary agrees with the marks. */
export function compareSummary(reference: string, text: string): CompareSummary {
  const a = Text.of(reference.split('\n'));
  const b = Text.of(text.split('\n'));
  const chunks = Chunk.build(a, b, { scanLimit: 500 });
  let added = 0;
  let removed = 0;
  let approximate = false;
  for (const c of chunks) {
    removed += spanLines(a, c.fromA, c.toA);
    added += spanLines(b, c.fromB, c.toB);
    if (!c.precise) approximate = true;
  }
  return { identical: chunks.length === 0, differences: chunks.length, added, removed, approximate };
}

const lines = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;

export function formatSummary(s: CompareSummary, refLabel: string): string {
  if (s.identical) return `Identical to ${refLabel}`;
  const n = `${s.differences} ${s.differences === 1 ? 'difference' : 'differences'}`;
  return `${n}: +${lines(s.added)}, -${lines(s.removed)} vs ${refLabel}${s.approximate ? ' (approximate)' : ''}`;
}

/** The header line of a compared pane: `Empty` for an empty text (nothing to compare), otherwise the formatted summary. */
export function describeCompare(reference: string, text: string, refLabel: string): string {
  return text === '' ? 'Empty' : formatSummary(compareSummary(reference, text), refLabel);
}

export const PANE_LABELS = ['Code A', 'Code B', 'Code C', 'Code D'] as const;

export interface CompareState {
  texts: [string, string, string, string];
  count: 2 | 3 | 4;
  reference: 0 | 1 | 2 | 3;
}

const KEY = 'compare.v1';

export function defaultCompareState(): CompareState {
  return { texts: ['', '', '', ''], count: 2, reference: 0 };
}

export function loadCompareState(): CompareState {
  const raw = loadJson<unknown>(KEY, null);
  if (!raw || typeof raw !== 'object') return defaultCompareState();
  const r = raw as Record<string, unknown>;
  const { texts, count, reference } = r;
  if (!Array.isArray(texts) || texts.length !== 4 || !texts.every((t) => typeof t === 'string')) return defaultCompareState();
  if (count !== 2 && count !== 3 && count !== 4) return defaultCompareState();
  if (reference !== 0 && reference !== 1 && reference !== 2 && reference !== 3) return defaultCompareState();
  return { texts: texts as CompareState['texts'], count, reference };
}

export function saveCompareState(state: CompareState): boolean {
  return saveJson(KEY, state).ok;
}

export interface SavedPine {
  label: string;
  source: string;
}

/** The Pine indicators saved on the chart (read only), labelled by their declared title. */
export function savedPineScripts(): SavedPine[] {
  const prefs = loadJson<unknown>('prefs.v1', null);
  const list = prefs && typeof prefs === 'object' ? (prefs as { indicators?: unknown }).indicators : undefined;
  if (!Array.isArray(list)) return [];
  const out: SavedPine[] = [];
  for (const i of list) {
    if (!i || typeof i !== 'object') continue;
    const o = i as { kind?: unknown; source?: unknown };
    if (o.kind !== 'pine') continue;
    const source = typeof o.source === 'string' ? o.source : '';
    out.push({ label: pineSourceTitle(source) || `Pine indicator ${out.length + 1}`, source });
  }
  return out;
}
