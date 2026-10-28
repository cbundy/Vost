import { useEffect, useMemo, useRef, useState } from 'react';
import { analyzeCsv, buildCandles, type ColumnMapping, type CsvAnalysis, type CsvAnalyzeOptions } from '../lib/csv';
import { fmtNum, fmtTime } from '../lib/format';
import { generateDemoCandles } from '../lib/providers/demo';
import { useStore } from '../state/store';
import { Modal } from './Modal';

type Role = 'ignore' | 'time' | 'date' | 'open' | 'high' | 'low' | 'close' | 'volume';

const ROLES: Role[] = ['ignore', 'time', 'date', 'open', 'high', 'low', 'close', 'volume'];

const DELIMITERS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Auto-detect' },
  { value: ',', label: 'Comma  ,' },
  { value: ';', label: 'Semicolon  ;' },
  { value: '\t', label: 'Tab' },
  { value: '|', label: 'Pipe  |' },
  { value: ' ', label: 'Space' },
];

function rolesFromMapping(analysis: CsvAnalysis): Role[] {
  const roles: Role[] = analysis.header.map(() => 'ignore');
  const m = analysis.mapping;
  if (m.time >= 0) roles[m.time] = 'time';
  if (m.date >= 0) roles[m.date] = 'date';
  if (m.open >= 0) roles[m.open] = 'open';
  if (m.high >= 0) roles[m.high] = 'high';
  if (m.low >= 0) roles[m.low] = 'low';
  if (m.close >= 0) roles[m.close] = 'close';
  if (m.volume >= 0) roles[m.volume] = 'volume';
  return roles;
}

function mappingFromRoles(roles: Role[]): ColumnMapping {
  const find = (role: Role): number => roles.indexOf(role);
  return {
    time: find('time'),
    date: find('date'),
    open: find('open'),
    high: find('high'),
    low: find('low'),
    close: find('close'),
    volume: find('volume'),
  };
}

export function CsvImportModal({ onClose }: { onClose: () => void }) {
  const addDataset = useStore((s) => s.addDataset);
  const pushToast = useStore((s) => s.pushToast);
  const timeZone = useStore((s) => s.timeZone);

  const [fileName, setFileName] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [opts, setOpts] = useState<CsvAnalyzeOptions>({});
  const [roles, setRoles] = useState<Role[]>([]);
  const [dayFirst, setDayFirst] = useState(false);
  const [name, setName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analysis = useMemo(() => {
    if (!text) return null;
    try {
      const a = analyzeCsv(text, opts);
      setError(null);
      return a;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, opts.delimiter, opts.hasHeader]);

  // Sync the column-role dropdowns whenever a new analysis arrives.
  useEffect(() => {
    if (analysis) {
      setRoles(rolesFromMapping(analysis));
      setDayFirst(analysis.dayFirst);
    }
  }, [analysis]);

  const built = useMemo(() => {
    if (!analysis || roles.length === 0) return null;
    try {
      const mapping = mappingFromRoles(roles);
      const result = buildCandles(analysis, { mapping, dayFirst });
      return { result, error: null as string | null };
    } catch (err) {
      return { result: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [analysis, roles, dayFirst]);

  const loadFile = async (file: File) => {
    setFileName(file.name);
    setName(file.name.replace(/\.[^.]+$/, ''));
    const content = await file.text();
    setText(content);
  };

  const importNow = () => {
    if (!built?.result) return;
    const r = built.result;
    addDataset({
      name: name.trim() || fileName || 'Imported CSV',
      candles: r.candles,
      source: 'csv',
      description: `CSV · ${fileName || 'pasted data'} · ${r.barLabel}`,
      barSeconds: r.barSeconds,
      barLabel: r.barLabel,
    });
    pushToast('success', `Imported ${fmtNum(r.candles.length, 0)} bars — chart & backtest are fully offline-ready.`);
    onClose();
  };

  const importDemo = () => {
    const candles = generateDemoCandles({ bars: 2000, timeframe: '1d', seed: 1337 });
    addDataset({
      name: 'Demo dataset (synthetic)',
      candles,
      source: 'demo',
      description: 'Synthetic daily candles · offline',
      barSeconds: 86400,
      barLabel: '1d',
    });
    pushToast('success', 'Demo dataset loaded — no network involved.');
    onClose();
  };

  const m = mappingFromRoles(roles);

  return (
    <Modal
      title="Import OHLCV CSV — chart anything, even offline"
      onClose={onClose}
      width={940}
      footer={
        <>
          <button className="ghost" onClick={importDemo} title="Create a synthetic dataset with zero network access">
            Load demo dataset
          </button>
          <div className="dock-spacer" />
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!built?.result} onClick={importNow}>
            {built?.result ? `Import ${fmtNum(built.result.candles.length, 0)} bars` : 'Import'}
          </button>
        </>
      }
    >
      {!text && (
        <div>
          <div
            className={`dropzone${drag ? ' drag' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              const f = e.dataTransfer.files?.[0];
              if (f) void loadFile(f);
            }}
          >
            <div className="dz-icon">🗂</div>
            <div style={{ fontSize: 14, marginBottom: 4 }}>Drop a CSV file here, or click to browse</div>
            <div className="muted-2" style={{ fontSize: 12 }}>
              TradingView · Yahoo Finance · Stooq · Binance · MT4 exports · anything with a timestamp + OHLC columns
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,.tsv,text/csv,text/plain"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void loadFile(f);
              }}
            />
          </div>
          <div className="mt-3">
            {!showPaste ? (
              <button className="ghost" onClick={() => setShowPaste(true)}>
                …or paste CSV text
              </button>
            ) : (
              <div>
                <div className="section-title">Paste CSV text</div>
                <textarea
                  className="code-editor"
                  style={{ minHeight: 120 }}
                  placeholder={'Date,Open,High,Low,Close,Volume\n2024-01-02,102.3,105.1,101.8,104.4,1200345'}
                  value={pasteValue}
                  onChange={(e) => setPasteValue(e.target.value)}
                />
                <button className="primary mt-2" disabled={!pasteValue.trim()} onClick={() => {
                  setFileName('pasted.csv');
                  setName('Pasted data');
                  setText(pasteValue);
                }}>
                  Analyze pasted text
                </button>
              </div>
            )}
          </div>
          <div className="hint mt-3">
            Nothing is uploaded anywhere — the file is parsed and stored <b>in your browser</b>. Once imported, charts and backtests keep
            working with the network switched off.
          </div>
        </div>
      )}

      {text && error && (
        <div>
          <div style={{ color: 'var(--red)', marginBottom: 10 }}>Could not parse the file: {error}</div>
          <button onClick={() => setText(null)}>Try another file</button>
        </div>
      )}

      {text && !error && analysis && (
        <div>
          <div className="form-row wrap mb-3">
            <label className="field">
              <span className="muted-2" style={{ fontSize: 11, textTransform: 'uppercase' }}>Delimiter</span>
              <select value={opts.delimiter ?? ''} onChange={(e) => setOpts((o) => ({ ...o, delimiter: e.target.value || undefined }))}>
                {DELIMITERS.map((d) => (
                  <option key={d.label} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="muted-2" style={{ fontSize: 11, textTransform: 'uppercase' }}>Header row</span>
              <select
                value={opts.hasHeader == null ? 'auto' : opts.hasHeader ? 'yes' : 'no'}
                onChange={(e) =>
                  setOpts((o) => ({ ...o, hasHeader: e.target.value === 'auto' ? undefined : e.target.value === 'yes' }))
                }
              >
                <option value="auto">Auto ({analysis.hasHeader ? 'detected: yes' : 'detected: no'})</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </label>
            <label className="field">
              <span className="muted-2" style={{ fontSize: 11, textTransform: 'uppercase' }}>Date order</span>
              <select value={dayFirst ? 'dmy' : 'mdy'} onChange={(e) => setDayFirst(e.target.value === 'dmy')}>
                <option value="mdy">mm/dd/yyyy</option>
                <option value="dmy">dd/mm/yyyy</option>
              </select>
            </label>
            <div className="dock-spacer" />
            <button className="ghost" onClick={() => setText(null)}>
              ← Choose another file
            </button>
          </div>

          <div className="table-wrap mb-3" style={{ maxHeight: 320 }}>
            <table className="data-table">
              <thead>
                <tr>
                  {analysis.header.map((h, i) => (
                    <th key={i} style={{ textAlign: 'left', minWidth: 92 }}>
                      <select
                        value={roles[i] ?? 'ignore'}
                        style={{ width: '100%', fontSize: 11, padding: '2px 4px' }}
                        onChange={(e) => {
                          const role = e.target.value as Role;
                          setRoles((prev) => {
                            const next = prev.map((r) => (r === role && role !== 'ignore' ? 'ignore' : r));
                            next[i] = role;
                            return next;
                          });
                        }}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r === 'ignore' ? '— ignore —' : r.toUpperCase()}
                          </option>
                        ))}
                      </select>
                      <div className="muted-2" style={{ fontWeight: 400, textTransform: 'none', marginTop: 3, fontSize: 10.5 }} title={h}>
                        {h.length > 14 ? `${h.slice(0, 13)}…` : h}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analysis.preview.slice(analysis.hasHeader ? 1 : 0, 9).map((row, ri) => (
                  <tr key={ri}>
                    {analysis.header.map((_, ci) => (
                      <td key={ci} style={{ textAlign: 'left' }}>
                        {row[ci] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {built?.error && <div style={{ color: 'var(--red)', marginBottom: 10 }}>{built.error}</div>}

          {built?.result && (
            <div className="row wrap">
              <span className="badge green">{fmtNum(built.result.candles.length, 0)} candles</span>
              <span className="badge">bar size ≈ {built.result.barLabel}</span>
              <span className="badge">
                {fmtTime(built.result.candles[0].time, { timeZone })} →{' '}
                {fmtTime(built.result.candles[built.result.candles.length - 1].time, { timeZone })}
              </span>
              {built.result.dropped > 0 && <span className="badge amber">{built.result.dropped} rows skipped</span>}
              {built.result.adjusted > 0 && <span className="badge amber">{built.result.adjusted} OHLC fixes</span>}
            </div>
          )}

          {(built?.result?.warnings.length ?? 0) > 0 && (
            <ul className="hint mt-2" style={{ margin: '8px 0 0 16px' }}>
              {built!.result!.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}

          <div className="form-row mt-3">
            <label className="form-field" style={{ minWidth: 'min(280px, 100%)' }}>
              <span>Dataset name</span>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="My dataset" />
            </label>
            <span className="hint">
              Columns mapped: time{m.time >= 0 ? ` #${m.time + 1}` : ''}
              {m.date >= 0 ? ` + date #${m.date + 1}` : ''}, O{m.open >= 0 ? ` #${m.open + 1}` : ' ?'}, H
              {m.high >= 0 ? ` #${m.high + 1}` : ' ?'}, L{m.low >= 0 ? ` #${m.low + 1}` : ' ?'}, C
              {m.close >= 0 ? ` #${m.close + 1}` : ' ?'}
              {m.volume >= 0 ? `, V #${m.volume + 1}` : ', V —'}
            </span>
          </div>
        </div>
      )}
    </Modal>
  );
}
