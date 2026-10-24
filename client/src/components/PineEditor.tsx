import { useEffect, useRef } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
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
    '&': { backgroundColor: '#0c0f17', border: '1px solid var(--border-2)', borderRadius: 'var(--radius-sm)', fontSize: '12.5px' },
    '&.cm-focused': { outline: '1px solid var(--border-2)' },
    '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.55' },
    '.cm-content': { caretColor: '#e6e8ef' },
    '.cm-cursor': { borderLeftColor: '#e6e8ef' },
    '.cm-gutters': { backgroundColor: '#0c0f17', color: '#5c6784', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.03)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(100,140,255,0.3)' },
    '.cm-tooltip': { backgroundColor: '#161b27', border: '1px solid var(--border-2)', color: '#e6e8ef' },
    '.cm-tooltip-autocomplete ul li[aria-selected]': { backgroundColor: 'rgba(100,140,255,0.3)', color: '#e6e8ef' },
    '&.cm-focused .cm-matchingBracket': { backgroundColor: 'rgba(100,140,255,0.35)', outline: 'none' },
  },
  { dark: true },
);

interface Props {
  value: string;
  onChange: (value: string) => void;
  error?: PineEditorError | null;
  ariaLabel?: string;
  minHeight?: number;
}

/** CodeMirror 6 editor for Pine Script with highlighting, autocomplete and inline error markers. */
export function PineEditor({ value, onChange, error, ariaLabel = 'Pine source', minHeight = 200 }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const sizing = useRef(new Compartment());

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
          EditorState.tabSize.of(2),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel, spellcheck: 'false' }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
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

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const d = error ? errorToDiagnostic(error, v.state.doc.toString()) : null;
    v.dispatch(setDiagnostics(v.state, d ? [d] : []));
  }, [error, value]);

  return <div ref={host} className="pine-editor" />;
}
