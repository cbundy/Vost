import { useEffect, useRef, useState } from 'react';
import { useDialogKeys } from '../lib/useDialogKeys';
import { detectPineVersion } from '../lib/pine/version';
import { pineIndicatorName } from '../lib/pine/title';
import { resolvePineSelection } from '../lib/pineSelection';
import { fmtTime } from '../lib/format';
import type { PineInputValue, PineMessages } from '../lib/pine/types';
import { useStore } from '../state/store';
import { type PineRunState } from '../state/chart';
import { PineConvert } from './PineConvert';
import { PineEditor } from './PineEditor';
import { PineInputList } from './PineInputControl';
import { PineLibraries } from './PineLibraries';
import { useChart } from '../state/chartContext';

/**
 * The Pine editor pane beside the chart: one Pine indicator at a time in a full-height editor.
 * `dialog` is the narrow-window form: a modal dialog covering the chart area.
 */
export function PinePane({ dialog, onClose }: { dialog: boolean; onClose: () => void }) {
  const indicators = useChart((s) => s.indicators);
  const selectedPineId = useChart((s) => s.selectedPineId);
  const pineRuns = useChart((s) => s.pineRuns);
  const updateIndicator = useChart((s) => s.updateIndicator);
  const addIndicator = useChart((s) => s.addIndicator);
  const openPineEditor = useStore((s) => s.openPineEditor);
  const rootRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [libraries, setLibraries] = useState<{ path: string } | null>(null);

  useEffect(() => {
    if (dialog) closeRef.current?.focus();
  }, [dialog]);
  useDialogKeys(rootRef, dialog, onClose);

  const pines = indicators.filter((i) => i.kind === 'pine');
  const activeId = resolvePineSelection(indicators, selectedPineId);
  const active = pines.find((i) => i.id === activeId);

  const label = (i: (typeof pines)[number], n: number) =>
    `${n + 1}. ${pineIndicatorName(i.source ?? '', pineRuns[i.id]?.result?.declaration.title)} (${i.color})`;

  return (
    <section
      ref={rootRef}
      className={`pine-pane${dialog ? ' dialog' : ''}`}
      aria-label="Pine editor"
      {...(dialog ? { role: 'dialog', 'aria-modal': true } : {})}
    >
      <div className="pine-pane-head">
        <span className="pine-pane-title">Pine Editor</span>
        {active && (
          <>
            <span className="pine-swatch" style={{ background: active.color }} aria-hidden="true" />
            <select aria-label="Pine indicator" value={active.id} onChange={(ev) => openPineEditor(ev.target.value)}>
              {pines.map((i, n) => (
                <option key={i.id} value={i.id}>
                  {label(i, n)}
                </option>
              ))}
            </select>
          </>
        )}
        <a className="pine-compare-link" href="/compare" target="_blank" rel="noopener" title="Compare Pine scripts side by side">
          Compare
        </a>
        <button className="ghost pine-libs-button" onClick={() => setLibraries({ path: '' })} title="Libraries that scripts import">
          Libraries
        </button>
        <span className="pine-pane-spacer" />
        <button ref={closeRef} className="ghost icon" aria-label="Close Pine editor" title="Close (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>
      {active ? (
        <PineEntry
          key={active.id}
          source={active.source ?? ''}
          overrides={active.inputs ?? {}}
          run={pineRuns[active.id]}
          onSource={(source) => updateIndicator(active.id, { source })}
          onInput={(name, v) => updateIndicator(active.id, { inputs: { [name]: v } })}
          onPasteLibrary={(path) => setLibraries({ path })}
        />
      ) : (
        <div className="pine-empty">
          <div className="muted-2">No Pine indicators on this chart.</div>
          <button className="primary" onClick={() => openPineEditor(addIndicator('pine'))}>
            Add Pine indicator
          </button>
        </div>
      )}
      {libraries && <PineLibraries initialPath={libraries.path} onClose={() => setLibraries(null)} />}
    </section>
  );
}

function PineEntry({
  source,
  overrides,
  run,
  onSource,
  onInput,
  onPasteLibrary,
}: {
  source: string;
  overrides: Record<string, PineInputValue>;
  run: PineRunState | undefined;
  onSource: (source: string) => void;
  onInput: (name: string, v: PineInputValue) => void;
  onPasteLibrary: (path: string) => void;
}) {
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const { version } = detectPineVersion(source);
  const error = run?.error;
  const inputs = run?.result?.inputs ?? [];
  return (
    <div className="pine-entry">
      <div className="pine-entry-editor">
        <PineEditor value={source} onChange={onSource} error={error} ariaLabel="Pine source" minHeight={60} onCursor={(line, col) => setCursor({ line, col })} />
      </div>
      {run?.running && <div className="muted-2" style={{ fontSize: 11.5 }}>Running…</div>}
      <PineConvert source={source} error={error} onChange={onSource} />
      {error?.library && (
        <div className="pine-error-actions">
          <button className="primary" onClick={() => onPasteLibrary(error.library!)}>
            Paste library
          </button>
        </div>
      )}
      {inputs.length > 0 && (
        <PineInputList
          inputs={inputs}
          valueOf={(inp) => overrides[inp.name] ?? inp.defval}
          onChange={(inp, v) => onInput(inp.name, v)}
        />
      )}
      {!error && run?.result?.messages && <PineMessagesView messages={run.result.messages} />}
      <div className="pine-status">
        <span>
          Ln {cursor.line}, Col {cursor.col}
        </span>
        <span>{version === null ? 'no version' : `Pine v${version}`}</span>
      </div>
    </div>
  );
}

function PineMessagesView({ messages }: { messages: PineMessages }) {
  const timeZone = useStore((s) => s.timeZone);
  const { alerts, alertConditions, logs, omitted } = messages;
  if (alerts.length + alertConditions.length + logs.length === 0) return null;
  const at = (t: number) => fmtTime(t, { timeZone });
  const more = (n: number) => n > 0 && <div className="pine-msg-more">{n} more not shown</div>;
  return (
    <div className="pine-messages" aria-label="Pine messages">
      <div className="pine-msg-title">Messages</div>
      {alerts.length > 0 && (
        <section className="pine-msg-group" aria-label="Alerts">
          <h4>Alerts ({alerts.length + omitted.alerts})</h4>
          <ul>
            {alerts.map((a, i) => (
              <li key={i}>
                <span className="pine-msg-time">{at(a.time)}</span> {a.message}
              </li>
            ))}
          </ul>
          {more(omitted.alerts)}
        </section>
      )}
      {alertConditions.length > 0 && (
        <section className="pine-msg-group" aria-label="Alert conditions">
          <h4>Alert conditions ({alertConditions.length})</h4>
          <ul>
            {alertConditions.map((c, i) => (
              <li key={i}>
                <strong>{c.title}</strong>
                {c.message && <> - {c.message}</>}
                <div className="pine-msg-time">
                  true on {c.count} {c.count === 1 ? 'bar' : 'bars'}, last {at(c.times[c.times.length - 1])}
                </div>
              </li>
            ))}
          </ul>
          {more(omitted.conditionTimes)}
        </section>
      )}
      {logs.length > 0 && (
        <section className="pine-msg-group" aria-label="Logs">
          <h4>Logs ({logs.length + omitted.logs})</h4>
          <ul>
            {logs.map((l, i) => (
              <li key={i} className={`pine-log-${l.level}`}>
                <span className="pine-msg-time">{at(l.time)}</span> <span className="pine-log-level">{l.level}</span> {l.text}
              </li>
            ))}
          </ul>
          {more(omitted.logs)}
        </section>
      )}
    </div>
  );
}
