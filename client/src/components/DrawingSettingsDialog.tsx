import { useState, type ReactNode } from 'react';
import { MAX_LEVELS, VISIBILITY_FIELDS, addLevel, colorHex, cleanLevels, pickValid, removeLevel, resolveStyle, setLevelValue, validateValue, type FibLevel, type SettingField } from '../lib/drawingStyle';
import { LINE_STYLES } from '../lib/drawingStyle';
import { TEXT_MAX, cleanText, type Anchor, type DrawingPatch } from '../lib/drawings';
import type { DrawingSettingsModel } from './chart/useDrawingSettings';
import { Modal } from './Modal';

type Tab = 'style' | 'text' | 'coordinates' | 'visibility';
const TAB_LABEL: Record<Tab, string> = { style: 'Style', text: 'Text', coordinates: 'Coordinates', visibility: 'Visibility' };

/** A number input that keeps what is typed and only passes on a finite value in range; anything else is refused in place. */
function NumField({ label, value, min, max, step, onCommit }: { label: string; value: number; min?: number; max?: number; step?: number; onCommit(n: number): void }) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const change = (raw: string) => {
    setText(raw);
    const n = raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(n)) return setError('Enter a finite number.');
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) return setError(`Enter a number from ${min ?? '-∞'} to ${max ?? '∞'}.`);
    setError(null);
    onCommit(n);
  };
  return (
    <span className="ds-num">
      <input type="number" value={text} min={min} max={max} step={step ?? 'any'} aria-label={label} aria-invalid={error != null} onChange={(e) => change(e.target.value)} />
      {error && (
        <span className="ds-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

function LevelsEditor({ levels, onChange }: { levels: FibLevel[]; onChange(l: FibLevel[]): void }) {
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const n = adding.trim() === '' ? NaN : Number(adding);
    const next = addLevel(levels, n);
    if (!next) {
      setError(!Number.isFinite(n) ? 'Enter a finite number.' : levels.length >= MAX_LEVELS ? `At most ${MAX_LEVELS} levels.` : levels.some((l) => l.value === n) ? 'That level exists.' : 'Level out of range.');
      return;
    }
    setError(null);
    setAdding('');
    onChange(next);
  };
  return (
    <div className="ds-levels">
      {levels.map((l, i) => (
        <div className="ds-level" key={i}>
          <input type="checkbox" checked={l.on} aria-label={`Level ${l.value} on`} onChange={(e) => onChange(levels.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
          <NumField label={`Level ${i + 1} value`} value={l.value} step={0.001} onCommit={(n) => { const next = setLevelValue(levels, i, n); if (next) onChange(next); }} />
          <input type="color" value={colorHex(l.color) ?? '#3b82f6'} aria-label={`Level ${l.value} colour`} onChange={(e) => onChange(levels.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} />
          <button type="button" className="ghost icon" aria-label={`Remove level ${l.value}`} title="Remove level" onClick={() => onChange(removeLevel(levels, i))}>
            ✕
          </button>
        </div>
      ))}
      <div className="ds-level">
        <input type="number" step="any" value={adding} placeholder="New level" aria-label="New level value" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        <button type="button" onClick={add}>
          Add level
        </button>
        {error && (
          <span className="ds-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

function FieldRow({ field, value, onChange }: { field: SettingField; value: unknown; onChange(v: unknown): void }): ReactNode {
  let control: ReactNode;
  switch (field.kind) {
    case 'color':
      control = <input type="color" value={colorHex(value) ?? '#3b82f6'} aria-label={field.label} onChange={(e) => onChange(e.target.value)} />;
      break;
    case 'opacity':
      control = (
        <>
          <input type="range" min={field.min ?? 0} max={field.max ?? 1} step={field.step ?? 0.05} value={value as number} aria-label={field.label} onChange={(e) => onChange(Number(e.target.value))} />
          <span className="ds-readout">{Math.round((value as number) * 100)}%</span>
        </>
      );
      break;
    case 'width':
    case 'number':
      control = <NumField label={field.label} value={value as number} min={field.min} max={field.max} step={field.step} onCommit={onChange} />;
      break;
    case 'lineStyle':
      control = (
        <select value={value as string} aria-label={field.label} onChange={(e) => onChange(e.target.value)}>
          {LINE_STYLES.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      );
      break;
    case 'boolean':
      control = <input type="checkbox" checked={value === true} aria-label={field.label} onChange={(e) => onChange(e.target.checked)} />;
      break;
    case 'levels':
      return (
        <div className="ds-row ds-wide" key={field.key}>
          <div className="ds-label">{field.label}</div>
          <LevelsEditor levels={value as FibLevel[]} onChange={onChange} />
        </div>
      );
  }
  return (
    <div className="ds-row" key={field.key}>
      <span className="ds-label">{field.label}</span>
      <span className="ds-control">{control}</span>
    </div>
  );
}

const utc = (t: number) => {
  const d = new Date(t * 1000);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
};

/**
 * The drawing settings dialog. Its tabs and controls come from the tool's settings descriptor; every edit shows on the
 * chart at once (without history) and OK keeps them all as one undo step.
 */
export function DrawingSettingsDialog({ model }: { model: DrawingSettingsModel }) {
  const { drawing, tool, userDefault } = model;
  const fields = tool.settings ?? [];
  const [tab, setTab] = useState<Tab>('style');
  const [style, setStyleState] = useState<Record<string, unknown>>(drawing.style ?? {});
  const [text, setTextState] = useState(drawing.text ?? '');
  const [anchors, setAnchors] = useState<Anchor[]>(drawing.anchors);
  // Remounts the numeric inputs after Reset so they show the defaults again.
  const [epoch, setEpoch] = useState(0);

  const tabs: Tab[] = ['style', ...(tool.text || fields.some((f) => f.tab === 'text') ? (['text'] as const) : []), 'coordinates', 'visibility'];
  const values = resolveStyle(fields, style, userDefault).values;
  const textBad = tool.text === true && cleanText(text) === '';

  const preview = (next: { style?: Record<string, unknown>; text?: string; anchors?: Anchor[] }) => {
    const st = next.style ?? style;
    const patch: DrawingPatch = { anchors: next.anchors ?? anchors, style: st };
    if (tool.text) patch.text = cleanText(next.text ?? text) || drawing.text;
    model.onPreview(patch);
  };
  const setField = (key: string, v: unknown) => {
    const next = { ...style, [key]: v };
    setStyleState(next);
    preview({ style: next });
  };
  const reset = () => {
    // Clears only this tool's own settings: visibility switches and keys a newer app stored stay.
    const next = { ...style };
    for (const f of fields) delete next[f.key];
    setStyleState(next);
    setEpoch((e) => e + 1);
    preview({ style: next });
  };
  const saveDefault = () => {
    const own = pickValid(fields, values);
    model.onSaveDefault(own);
  };

  const shown = tab === 'visibility' ? VISIBILITY_FIELDS : fields.filter((f) => f.tab === tab);

  return (
    <Modal
      title={`${tool.label} settings`}
      onClose={model.onCancel}
      width={520}
      footer={
        <>
          <button type="button" className="ds-reset" onClick={reset}>
            Reset
          </button>
          <button type="button" onClick={saveDefault} title="Use this style for new drawings of this tool">
            Save as default
          </button>
          <span className="ds-spacer" />
          <button type="button" onClick={model.onCancel}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={model.onApply} disabled={textBad}>
            OK
          </button>
        </>
      }
    >
      <div className="ds-tabs" role="tablist" aria-label="Settings sections">
        {tabs.map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`ds-tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {TAB_LABEL[t]}
          </button>
        ))}
      </div>
      <div className="ds-panel" role="tabpanel" aria-label={TAB_LABEL[tab]} key={`${tab}-${epoch}`}>
        {tab === 'text' && tool.text && (
          <div className="ds-row ds-wide">
            <textarea value={text} maxLength={TEXT_MAX} rows={4} aria-label="Text" aria-invalid={textBad} onChange={(e) => { setTextState(e.target.value); preview({ text: e.target.value }); }} />
            {textBad && (
              <span className="ds-error" role="alert">
                A note needs some text.
              </span>
            )}
          </div>
        )}
        {tab === 'coordinates' &&
          anchors.map((a, i) => (
            <div className="ds-coord" key={i}>
              <div className="ds-label">{anchors.length > 1 ? `Point ${i + 1}` : 'Point'}</div>
              <label>
                Price
                <NumField label={`Point ${i + 1} price`} value={a.price} onCommit={(n) => { const next = anchors.map((x, j) => (j === i ? { ...x, price: n } : x)); setAnchors(next); preview({ anchors: next }); }} />
              </label>
              <label>
                Time (unix seconds)
                <NumField label={`Point ${i + 1} time`} value={a.time} onCommit={(n) => { const next = anchors.map((x, j) => (j === i ? { ...x, time: n } : x)); setAnchors(next); preview({ anchors: next }); }} />
                <span className="ds-readout">{utc(a.time)}</span>
              </label>
            </div>
          ))}
        {tab !== 'coordinates' && (
          <>
            {tab === 'visibility' && <p className="muted-2 ds-hint">Show this drawing on these timeframes.</p>}
            {shown.map((f) => (
              <FieldRow key={f.key} field={f} value={f.kind === 'levels' ? (validateValue(f, values[f.key]) ?? cleanLevels(f.default)) : values[f.key]} onChange={(v) => setField(f.key, v)} />
            ))}
          </>
        )}
      </div>
    </Modal>
  );
}
