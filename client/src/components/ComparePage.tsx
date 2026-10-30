import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { PineEditor } from './PineEditor';
import { PANE_LABELS, describeCompare, loadCompareState, saveCompareState, savedPineScripts, type CompareState } from '../lib/pine/compare';
import { debounce } from '../lib/storage';

type Texts = CompareState['texts'];

/** Typing in the reference reaches the other panes after this long without a keystroke. */
const REFERENCE_DELAY_MS = 200;

const Pane = memo(function Pane({
  index,
  text,
  reference,
  referenceText,
  epoch,
  onText,
  onReplace,
}: {
  index: number;
  text: string;
  reference: number;
  /** What this pane is compared against; unused (and constant) in the reference pane. */
  referenceText: string;
  /** Changes when the diff must be rebuilt (reference replaced or switched, pane count changed). */
  epoch: number;
  /** The text changed by typing. */
  onText: (index: number, value: string) => void;
  /** The whole text was replaced (paste, drop, Load, Open file, Clear). */
  onReplace: (index: number, value: string) => void;
}) {
  const label = PANE_LABELS[index];
  const isRef = index === reference;
  const fileInput = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(() => savedPineScripts());
  // the diff of a long script is not worth a delay in the keystroke: the header catches up right after it
  const shownText = useDeferredValue(text);
  const summary = useMemo(() => (isRef ? null : describeCompare(referenceText, shownText, PANE_LABELS[reference])), [isRef, referenceText, shownText, reference]);

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
            if (s) onReplace(index, s.source);
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
            if (f) onReplace(index, await f.text());
          }}
        />
        <button onClick={() => onReplace(index, '')}>Clear</button>
      </div>
      <div className="compare-pane-editor">
        <PineEditor
          value={text}
          onChange={(v) => onText(index, v)}
          onReplace={(v) => onReplace(index, v)}
          ariaLabel={label}
          minHeight={120}
          compareTo={isRef ? undefined : referenceText}
          compareEpoch={epoch}
        />
      </div>
    </section>
  );
});

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

  // What the other panes compare against. It follows the reference text at once when that text is replaced or the
  // reference or pane count changes (epoch + 1 rebuilds each diff), and lags typing by REFERENCE_DELAY_MS.
  const [view, setView] = useState({ reference, count: state.count, text: state.texts[reference], epoch: 0 });
  if (view.reference !== reference || view.count !== state.count) {
    setView({ reference, count: state.count, text: state.texts[reference], epoch: view.epoch + 1 });
  }
  const latest = useRef(state);
  latest.current = state;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const setText = useCallback((i: number, value: string) => {
    setState((s) => {
      if (s.texts[i] === value) return s;
      const texts = [...s.texts] as Texts;
      texts[i] = value;
      return { ...s, texts };
    });
  }, []);
  const refIndex = () => (latest.current.reference < latest.current.count ? latest.current.reference : 0);
  const onText = useCallback(
    (i: number, value: string) => {
      setText(i, value);
      if (i !== refIndex()) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setView((v) => (v.text === latest.current.texts[refIndex()] ? v : { ...v, text: latest.current.texts[refIndex()] })), REFERENCE_DELAY_MS);
    },
    [setText],
  );
  const onReplace = useCallback(
    (i: number, value: string) => {
      setText(i, value);
      if (i !== refIndex()) return;
      clearTimeout(timer.current);
      setView((v) => ({ ...v, text: value, epoch: v.epoch + 1 }));
    },
    [setText],
  );
  // a pending reference update is applied before the page goes away, like the save
  useEffect(() => {
    const flush = () => {
      if (timer.current === undefined) return;
      clearTimeout(timer.current);
      setView((v) => ({ ...v, text: latest.current.texts[refIndex()] }));
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

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
          <Pane
            key={i}
            index={i}
            text={state.texts[i]}
            reference={reference}
            referenceText={i === reference ? '' : view.text}
            epoch={i === reference ? 0 : view.epoch}
            onText={onText}
            onReplace={onReplace}
          />
        ))}
      </main>
    </div>
  );
}
