import { editorTheme } from '../lib/theme';
import { useEffect, useRef } from 'react';
import { ChangeSet, Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection } from '@codemirror/view';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { lintGutter, setDiagnostics } from '@codemirror/lint';
import { tags as t } from '@lezer/highlight';
import { errorToDiagnostic, pineCompletions, pineLanguage, type PineEditorError } from '../lib/pine/language';

const highlight = HighlightStyle.define([
  { tag: t.keyword, color: '#c792ea' },
  { tag: t.typeName, color: '#ffcb6b' },
  { tag: t.namespace, color: '#82aaff' },
  { tag: t.meta, color: '#f78c6c' },
  { tag: t.comment, color: '#5c6784', fontStyle: 'italic' },
  { tag: t.string, color: '#c3e88d' },
  { tag: t.number, color: '#f78c6c' },
  { tag: t.special(t.variableName), color: '#89ddff' },
  { tag: t.operator, color: '#89ddff' },
]);

const theme = EditorView.theme(
  {
    '&': { backgroundColor: editorTheme.background, border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)', fontSize: '12.5px' },
    '&.cm-focused': { outline: '1px solid var(--border-2)' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
    '.cm-content': { caretColor: editorTheme.text },
    '.cm-cursor': { borderLeftColor: editorTheme.text },
    '.cm-gutters': { backgroundColor: editorTheme.background, color: editorTheme.gutterText, border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(100,140,255,0.3)' },
    '.cm-tooltip': { backgroundColor: editorTheme.tooltip, border: '1px solid var(--border-2)', color: editorTheme.text },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'rgba(100,140,255,0.3)', color: editorTheme.text },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: 'rgba(100,140,255,0.35)', outline: 'none' },
    // compare mode (unifiedMergeView): low-alpha green/red so syntax colours stay readable
    '.cm-changedLine, .cm-insertedLine': { backgroundColor: 'rgba(34,197,94,0.12)' },
    '.cm-changedText, ins.cm-insertedLine': { backgroundColor: 'rgba(34,197,94,0.28)', textDecoration: 'none' },
    '.cm-deletedChunk': { backgroundColor: 'rgba(239,68,68,0.12)', paddingLeft: '6px' },
    '.cm-deletedChunk .cm-deletedLine, .cm-deletedChunk del': { backgroundColor: 'rgba(239,68,68,0.3)', textDecoration: 'none' },
    '.cm-deletedChunk .cm-chunkButtons': { display: 'none' },
    '.cm-changeGutter': { width: '4px', paddingLeft: '1px' },
    '.cm-changedLineGutter': { backgroundColor: 'var(--green)' },
    '.cm-deletedLineGutter': { backgroundColor: 'var(--red)' },
  },
  { dark: true },
);

interface Props {
  value: string;
  onChange: (value: string) => void;
  error?: PineEditorError | null;
  ariaLabel?: string;
  minHeight?: number;
  /** Called with the 1-based line and column of the cursor on every change of the selection or document. */
  onCursor?: (line: number, col: number) => void;
  /** When set, the editor marks what differs from this text (added, changed and removed lines). */
  compareTo?: string;
}

// Loaded on first use so the diff library stays out of the chart app's main bundle.
type MergeLib = typeof import('@codemirror/merge');
const loadMerge = (): Promise<MergeLib> => import('@codemirror/merge');

const mergeExtension = (lib: MergeLib, original: string): Extension =>
  lib.unifiedMergeView({ original, mergeControls: false, highlightChanges: true, gutter: true, syntaxHighlightDeletions: true });

/** CodeMirror 6 editor for Pine Script with highlighting, autocomplete and inline error markers. */
export function PineEditor({ value, onChange, error, ariaLabel = 'Pine source', minHeight = 200, onCursor, compareTo }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;
  const sizing = useRef(new Compartment());
  const merge = useRef(new Compartment());
  const compareRef = useRef(compareTo);
  const shown = useRef(false);

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          lintGutter(),
          pineLanguage,
          syntaxHighlighting(highlight),
          autocompletion({ override: [pineCompletions] }),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
          theme,
          sizing.current.of(EditorView.theme({ '.cm-scroller': { minHeight: `${minHeight}px` } })),
          merge.current.of([]),
          EditorState.tabSize.of(2),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'false' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
            if (u.docChanged || u.selectionSet) {
              const head = u.state.selection.main.head;
              const line = u.state.doc.lineAt(head);
              onCursorRef.current?.(line.number, head - line.from + 1);
            }
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep an external value in sync without resetting the cursor on our own edits.
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  // Compare mode: switch the diff on or off by reconfiguring; otherwise feed the new original in place.
  useEffect(() => {
    compareRef.current = compareTo;
    if (compareTo === undefined && !shown.current) return;
    let live = true;
    void loadMerge().then((lib) => {
      const v = view.current;
      const want = compareRef.current;
      if (!live || !v) return;
      if (want === undefined) {
        if (shown.current) v.dispatch({ effects: merge.current.reconfigure([]) });
        shown.current = false;
      } else if (!shown.current) {
        v.dispatch({ effects: merge.current.reconfigure(mergeExtension(lib, want)) });
        shown.current = true;
      } else {
        const cur = lib.getOriginalDoc(v.state);
        if (cur.toString() === want) return;
        const changes = ChangeSet.of({ from: 0, to: cur.length, insert: want }, cur.length);
        v.dispatch({ effects: lib.updateOriginalDoc.of({ doc: changes.apply(cur), changes }) });
      }
    });
    return () => {
      live = false;
    };
  }, [compareTo]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const d = error ? errorToDiagnostic(error, v.state.doc.toString()) : null;
    v.dispatch(setDiagnostics(v.state, d ? [d] : []));
  }, [error, value]);

  return <div ref={host} className="pine-editor" />;
}
