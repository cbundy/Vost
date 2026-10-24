import { INDICATOR_META, type IndicatorKind } from '../lib/indicatorCompute';
import { downloadFile, candlesToCsv, sanitizeFileName } from '../lib/export';
import { fmtNum, fmtTime } from '../lib/format';
import { getProvider } from '../lib/providers';
import type { PineInput, PineInputValue } from '../lib/pine/types';
import { PineEditor } from './PineEditor';
import { useStore, type PineRunState } from '../state/store';

export function Sidebar({ onImportCsv }: { onImportCsv: () => void }) {
  const providerId = useStore((s) => s.providerId);
  const symbol = useStore((s) => s.symbol);
  const candles = useStore((s) => s.candles);
  const dataLabel = useStore((s) => s.dataLabel);
  const datasets = useStore((s) => s.datasets);
  const activeDatasetId = useStore((s) => s.activeDatasetId);
  const indicators = useStore((s) => s.indicators);
  const setSymbol = useStore((s) => s.setSymbol);
  const saveCurrentDataset = useStore((s) => s.saveCurrentDataset);
  const activateDataset = useStore((s) => s.activateDataset);
  const removeDataset = useStore((s) => s.removeDataset);
  const addIndicator = useStore((s) => s.addIndicator);
  const removeIndicator = useStore((s) => s.removeIndicator);
  const updateIndicator = useStore((s) => s.updateIndicator);
  const pineRuns = useStore((s) => s.pineRuns);

  const provider = getProvider(providerId);
  const first = candles[0];
  const last = candles[candles.length - 1];

  return (
    <aside className="sidebar">
      <section className="sidebar-section">
        <div className="sidebar-title">
          <span>Data</span>
          {candles.length > 0 && <span className="badge">{fmtNum(candles.length, 0)} bars</span>}
        </div>
        {candles.length === 0 ? (
          <div className="sidebar-empty">
            No data loaded yet. Pick a provider above, or import a CSV file — CSV charting works completely offline.
          </div>
        ) : (
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {dataLabel}
            </div>
            {first && last && (
              <div className="muted-2" style={{ fontSize: 11.5, marginBottom: 8 }}>
                {fmtTime(first.time, { dateOnly: true })} → {fmtTime(last.time, { dateOnly: true })} · close {last.close}
              </div>
            )}
            <div className="form-row">
              <button onClick={() => saveCurrentDataset()} disabled={activeDatasetId != null} title="Keep these candles in the local library (stored in your browser)">
                Save to library
              </button>
              <button
                className="ghost"
                onClick={() =>
                  downloadFile(
                    `${sanitizeFileName(dataLabel || 'candles')}.csv`,
                    candlesToCsv(candles, { isoDates: false }),
                  )
                }
                title="Export these candles as CSV"
              >
                Export CSV
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="sidebar-section">
        <div className="sidebar-title">
          <span>Local library</span>
          <span className="badge">{datasets.length}</span>
        </div>
        {datasets.length === 0 ? (
          <div className="sidebar-empty">
            Imported CSVs and saved fetches appear here. They live in your browser's storage — charts and backtests keep working with the network off.
          </div>
        ) : (
          <div>
            {datasets.map((ds) => (
              <div
                key={ds.id}
                className={`dataset-item${ds.id === activeDatasetId ? ' active' : ''}`}
                onClick={() => activateDataset(ds.id)}
                title={ds.description}
              >
                <div className="ds-main">
                  <div className="ds-name">{ds.name}</div>
                  <div className="ds-meta">
                    {fmtNum(ds.candles.length, 0)} bars · {new Date(ds.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="ds-actions">
                  <button
                    className="ghost icon"
                    title="Export CSV"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      downloadFile(`${sanitizeFileName(ds.name)}.csv`, candlesToCsv(ds.candles));
                    }}
                  >
                    ⬇
                  </button>
                  <button
                    className="ghost icon"
                    title="Delete dataset"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      removeDataset(ds.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="form-row mt-2">
          <button className="ghost" onClick={onImportCsv}>
            + Import CSV file
          </button>
        </div>
      </section>

      <section className="sidebar-section">
        <div className="sidebar-title">
          <span>Watchlist · {provider.name}</span>
        </div>
        <div className="chip-list">
          {provider.popularSymbols.map((s) => (
            <button
              key={s.symbol}
              className={`chip${s.symbol === symbol ? ' active' : ''}`}
              title={s.label}
              onClick={() => setSymbol(s.symbol, { load: true })}
            >
              {s.symbol}
            </button>
          ))}
        </div>
      </section>

      <section className="sidebar-section" style={{ borderBottom: 'none' }}>
        <div className="sidebar-title">
          <span>Indicators</span>
          <span className="badge">{indicators.length}</span>
        </div>
        {indicators.map((spec) => {
          const meta = INDICATOR_META[spec.kind];
          return (
            <div className="indicator-item" key={spec.id}>
              <div className="indicator-head">
                <button
                  className="indicator-color"
                  style={{ background: spec.color }}
                  title="Change colour"
                  onClick={() => {
                    const palette = ['#f59e0b', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6', '#eab308', '#3b82f6'];
                    const idx = palette.indexOf(spec.color);
                    updateIndicator(spec.id, { color: palette[(idx + 1) % palette.length] });
                  }}
                />
                <span className="indicator-name" title={meta.description}>
                  {meta.name}
                </span>
                <button
                  className="ghost icon"
                  title={spec.visible ? 'Hide' : 'Show'}
                  onClick={() => updateIndicator(spec.id, { visible: !spec.visible })}
                >
                  {spec.visible ? '◉' : '◌'}
                </button>
                <button className="ghost icon" title="Remove" onClick={() => removeIndicator(spec.id)}>
                  ✕
                </button>
              </div>
              {meta.params.length > 0 && (
                <div className="indicator-params">
                  {meta.params.map((p) => (
                    <label className="param-field" key={p.key}>
                      {p.label}
                      <input
                        type="number"
                        value={spec.params[p.key] ?? p.default}
                        min={p.min}
                        max={p.max}
                        step={p.step ?? (p.type === 'int' ? 1 : 0.1)}
                        onChange={(ev) => {
                          const v = Number(ev.target.value);
                          if (Number.isFinite(v)) updateIndicator(spec.id, { params: { [p.key]: v } });
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
              {spec.kind === 'pine' && (
                <PineEntry
                  source={spec.source ?? ''}
                  overrides={spec.inputs ?? {}}
                  run={pineRuns[spec.id]}
                  onSource={(source) => updateIndicator(spec.id, { source })}
                  onInput={(name, v) => updateIndicator(spec.id, { inputs: { [name]: v } })}
                />
              )}
            </div>
          );
        })}

        <AddIndicator onAdd={addIndicator} />
      </section>
    </aside>
  );
}

function AddIndicator({ onAdd }: { onAdd: (kind: IndicatorKind) => void }) {
  const kinds: IndicatorKind[] = ['sma', 'ema', 'bb', 'vwap', 'volume', 'rsi', 'macd', 'pine'];
  return (
    <div className="add-indicator-row">
      <select
        id="add-indicator-select"
        defaultValue=""
        onChange={(ev) => {
          const kind = ev.target.value as IndicatorKind;
          if (kind) {
            onAdd(kind);
            ev.target.value = '';
          }
        }}
      >
        <option value="" disabled>
          Add indicator…
        </option>
        {kinds.map((k) => (
          <option key={k} value={k}>
            {INDICATOR_META[k].name}
          </option>
        ))}
      </select>
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
      <PineEditor value={source} onChange={onSource} error={error} ariaLabel="Pine source" minHeight={140} />
      {run?.running && <div className="muted-2" style={{ fontSize: 11.5 }}>Running…</div>}
      {error && (
        <div className="pine-error" role="alert" style={{ color: 'var(--neg, #ef4444)', fontSize: 11.5, whiteSpace: 'pre-wrap' }}>
          {error.line !== undefined ? `Line ${error.line}: ` : ''}
          {error.message}
        </div>
      )}
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
