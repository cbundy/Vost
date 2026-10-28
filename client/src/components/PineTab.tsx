import { resolvePineSelection } from '../lib/pineSelection';
import type { PineInput, PineInputValue } from '../lib/pine/types';
import { useStore, type PineRunState } from '../state/store';
import { PineConvert } from './PineConvert';
import { PineEditor } from './PineEditor';

/** The dock's Pine tab: one Pine indicator at a time in a full-height editor. */
export function PineTab() {
  const indicators = useStore((s) => s.indicators);
  const selectedPineId = useStore((s) => s.selectedPineId);
  const pineRuns = useStore((s) => s.pineRuns);
  const updateIndicator = useStore((s) => s.updateIndicator);
  const addIndicator = useStore((s) => s.addIndicator);
  const openPineEditor = useStore((s) => s.openPineEditor);

  const pines = indicators.filter((i) => i.kind === 'pine');
  const activeId = resolvePineSelection(indicators, selectedPineId);
  const active = pines.find((i) => i.id === activeId);

  if (!active) {
    return (
      <div className="pine-empty">
        <div className="muted-2">No Pine indicators on this chart.</div>
        <button className="primary" onClick={() => openPineEditor(addIndicator('pine'))}>
          Add Pine indicator
        </button>
      </div>
    );
  }

  const label = (i: (typeof pines)[number], n: number) =>
    `${n + 1}. ${pineRuns[i.id]?.result?.declaration.title || 'Pine indicator'} (${i.color})`;

  return (
    <div className="pine-tab">
      <div className="pine-tab-head">
        <span className="pine-swatch" style={{ background: active.color }} aria-hidden="true" />
        <select
          aria-label="Pine indicator"
          value={active.id}
          onChange={(ev) => openPineEditor(ev.target.value)}
        >
          {pines.map((i, n) => (
            <option key={i.id} value={i.id}>
              {label(i, n)}
            </option>
          ))}
        </select>
      </div>
      <PineEntry
        key={active.id}
        source={active.source ?? ''}
        overrides={active.inputs ?? {}}
        run={pineRuns[active.id]}
        onSource={(source) => updateIndicator(active.id, { source })}
        onInput={(name, v) => updateIndicator(active.id, { inputs: { [name]: v } })}
      />
    </div>
  );
}

function PineEntry({
  source,
  overrides,
  run,
  onSource,
  onInput,
}: {
  source: string;
  overrides: Record<string, PineInputValue>;
  run: PineRunState | undefined;
  onSource: (source: string) => void;
  onInput: (name: string, v: PineInputValue) => void;
}) {
  const error = run?.error;
  const inputs = run?.result?.inputs ?? [];
  return (
    <div className="pine-entry">
      <div className="pine-entry-editor">
        <PineEditor value={source} onChange={onSource} error={error} ariaLabel="Pine source" minHeight={60} />
      </div>
      {run?.running && <div className="muted-2" style={{ fontSize: 11.5 }}>Running…</div>}
      <PineConvert source={source} error={error} onChange={onSource} />
      {inputs.length > 0 && (
        <div className="indicator-params">
          {inputs.map((inp) => (
            <label className="param-field" key={inp.name}>
              {inp.name}
              <PineInputField input={inp} value={overrides[inp.name] ?? inp.defval} onChange={(v) => onInput(inp.name, v)} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function PineInputField({
  input,
  value,
  onChange,
}: {
  input: PineInput;
  value: PineInputValue | null;
  onChange: (v: PineInputValue) => void;
}) {
  if (input.options && input.options.length > 0) {
    return (
      <select value={String(value ?? '')} onChange={(ev) => onChange(input.options!.find((o) => String(o) === ev.target.value) ?? ev.target.value)}>
        {input.options.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    );
  }
  if (input.type === 'bool') {
    return <input type="checkbox" checked={Boolean(value)} onChange={(ev) => onChange(ev.target.checked)} />;
  }
  if (input.type === 'int' || input.type === 'float') {
    return (
      <input
        type="number"
        value={typeof value === 'number' ? value : ''}
        min={input.minval}
        max={input.maxval}
        step={input.step ?? (input.type === 'int' ? 1 : 0.1)}
        onChange={(ev) => {
          const v = Number(ev.target.value);
          if (ev.target.value !== '' && Number.isFinite(v)) onChange(v);
        }}
      />
    );
  }
  return <input type="text" value={String(value ?? '')} onChange={(ev) => onChange(ev.target.value)} />;
}
