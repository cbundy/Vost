import { useEffect, useRef } from 'react';
import { INDICATOR_META, type IndicatorKind } from '../lib/indicatorCompute';
import { downloadFile, candlesToCsv, sanitizeFileName } from '../lib/export';
import { fmtNum, fmtTime } from '../lib/format';
import { Watchlist } from './Watchlist';
import { useStore } from '../state/store';

const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

export function Sidebar({ onImportCsv, drawer }: { onImportCsv: () => void; drawer?: { onClose: () => void } }) {
  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onClose = drawer?.onClose;
  const isDrawer = drawer != null;

  // Drawer: focus the close button on open, keep Tab inside, close on Escape.
  useEffect(() => {
    if (!isDrawer) return;
    closeRef.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        onClose?.();
        return;
      }
      if (ev.key !== 'Tab') return;
      const root = asideRef.current;
      if (!root) return;
      const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((e) => e.getClientRects().length > 0);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!active || !root.contains(active)) {
        ev.preventDefault();
        (ev.shiftKey ? last : first).focus();
      } else if (ev.shiftKey && active === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && active === last) {
        ev.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDrawer, onClose]);

  const symbol = useStore((s) => s.symbol);
  const candles = useStore((s) => s.candles);
  const timeZone = useStore((s) => s.timeZone);
  const dataLabel = useStore((s) => s.dataLabel);
  const datasets = useStore((s) => s.datasets);
  const activeDatasetId = useStore((s) => s.activeDatasetId);
  const indicators = useStore((s) => s.indicators);
  const saveCurrentDataset = useStore((s) => s.saveCurrentDataset);
  const activateDataset = useStore((s) => s.activateDataset);
  const removeDataset = useStore((s) => s.removeDataset);
  const addIndicator = useStore((s) => s.addIndicator);
  const openPineEditor = useStore((s) => s.openPineEditor);
  const removeIndicator = useStore((s) => s.removeIndicator);
  const updateIndicator = useStore((s) => s.updateIndicator);

  const first = candles[0];
  const last = candles[candles.length - 1];

  return (
    <aside
      className={drawer ? 'sidebar drawer' : 'sidebar'}
      id="sidebar"
      ref={asideRef}
      {...(drawer ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Sidebar' } : {})}
    >
      {drawer && (
        <div className="drawer-head">
          <span>Sidebar</span>
          <button ref={closeRef} className="ghost icon" onClick={drawer.onClose} aria-label="Close sidebar" title="Close (Esc)">
            ✕
          </button>
        </div>
      )}
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
                {fmtTime(first.time, { dateOnly: true, timeZone })} → {fmtTime(last.time, { dateOnly: true, timeZone })} · close {last.close}
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
                    {fmtNum(ds.candles.length, 0)} bars · {fmtTime(ds.createdAt / 1000, { dateOnly: true, timeZone })}
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
        <Watchlist />
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
                {spec.kind === 'pine' && (
                  <button
                    className="ghost"
                    title="Edit in the Pine tab"
                    aria-label={`Edit ${meta.name} source`}
                    onClick={() => openPineEditor(spec.id)}
                  >
                    Edit
                  </button>
                )}
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
            </div>
          );
        })}

        <AddIndicator
          onAdd={(kind) => {
            const id = addIndicator(kind);
            if (kind === 'pine') openPineEditor(id);
          }}
        />
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
