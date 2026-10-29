import { useEffect, useMemo, useRef, useState } from 'react';
import { PineEditor } from './PineEditor';
import { PANE_LABELS, compareSummary, formatSummary, loadCompareState, saveCompareState, savedPineScripts, type CompareState } from '../lib/pine/compare';
import { debounce } from '../lib/storage';

type Texts = CompareState['texts'];

function Pane({
  index,
  text,
  reference,
  referenceText,
  onText,
}: {
  index: number;
  text: string;
  reference: number;
  referenceText: string;
  onText: (value: string) => void;
}) {
  const label = PANE_LABELS[index];
  const isRef = index === reference;
  const fileInput = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(() => savedPineScripts());
  const summary = useMemo(() => (isRef ? null : formatSummary(compareSummary(referenceText, text), PANE_LABELS[reference])), [isRef, referenceText, text, reference]);

  return (
    <section className="compare-pane" aria-label={label}>
      <div className="compare-pane-head">
        <span className="compare-pane-title">{label}</span>
        {isRef ? (
          <span className="compare-ref-tag">Reference</span>
        ) : (
          <span className="compare-summary" role="status" aria-live="polite">
            {summary}
          </span>
        )}
        <span className="pine-pane-spacer" />
        <select
          aria-label={`Load into ${label}`}
          value=""
          disabled={saved.length === 0}
          onFocus={() => setSaved(savedPineScripts())}
          onChange={(ev) => {
            const s = saved[Number(ev.target.value)];
            if (s) onText(s.source);
          }}
        >
          <option value="">{saved.length === 0 ? 'No saved Pine scripts' : 'Load...'}</option>
          {saved.map((s, n) => (
            <option key={n} value={n}>
              {s.label}
            </option>
          ))}
        </select>
        <button onClick={() => fileInput.current?.click()}>Open file</button>
        <input
          ref={fileInput}
          type="file"
          accept=".pine,.txt"
          hidden
          aria-label={`Open file into ${label}`}
          onChange={async (ev) => {
            const f = ev.target.files?.[0];
            ev.target.value = '';
            if (f) onText(await f.text());
          }}
        />
        <button onClick={() => onText('')}>Clear</button>
      </div>
      <div className="compare-pane-editor">
        <PineEditor value={text} onChange={onText} ariaLabel={label} minHeight={120} compareTo={isRef ? undefined : referenceText} />
      </div>
    </section>
  );
}

export default function ComparePage() {
  const [state, setState] = useState<CompareState>(loadCompareState);
  const save = useMemo(() => debounce((s: CompareState) => void saveCompareState(s), 250), []);

  useEffect(() => {
    document.title = 'Pine compare - Vost';
  }, []);
  useEffect(() => {
    save(state);
  }, [state, save]);
  useEffect(() => {
    const flush = () => save.flush();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [save]);

  const reference = state.reference < state.count ? state.reference : 0;
  const setText = (i: number) => (value: string) =>
    setState((s) => {
      if (s.texts[i] === value) return s;
      const texts = [...s.texts] as Texts;
      texts[i] = value;
      return { ...s, texts };
    });

  return (
    <div className="compare-page">
      <header className="compare-head">
        <h1>Pine compare</h1>
        <a href="/">Back to chart</a>
        <span className="pine-pane-spacer" />
        <label>
          Panes
          <select value={state.count} onChange={(ev) => setState((s) => ({ ...s, count: Number(ev.target.value) as CompareState['count'] }))}>
            {[2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Compare against
          <select value={reference} onChange={(ev) => setState((s) => ({ ...s, reference: Number(ev.target.value) as CompareState['reference'] }))}>
            {PANE_LABELS.slice(0, state.count).map((l, n) => (
              <option key={l} value={n}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </header>
      <main className={`compare-grid count-${state.count}`}>
        {PANE_LABELS.slice(0, state.count).map((_, i) => (
          <Pane key={i} index={i} text={state.texts[i]} reference={reference} referenceText={state.texts[reference]} onText={setText(i)} />
        ))}
      </main>
    </div>
  );
}
