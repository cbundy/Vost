import { useEffect, useMemo, useRef, useState } from 'react';
import type { Candle, Timeframe } from '../../../shared/market.ts';
import { getProvider, providers } from '../lib/providers';
import { CandleChart } from './CandleChart';
import { loadFromCsv, loadFromDataset, loadFromProvider, readLibrary, type Loaded } from './data';
import './strategyMaker.css';

const BARS = 1000;

export default function StrategyMakerPage() {
  const [providerId, setProviderId] = useState(providers[0].id);
  const provider = getProvider(providerId);
  const [symbol, setSymbol] = useState(provider.defaultSymbol);
  const [timeframe, setTimeframe] = useState<Timeframe>(provider.defaultTimeframe);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const library = useMemo(readLibrary, []);
  const [datasetId, setDatasetId] = useState('');
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    document.title = 'Strategy maker - Vost';
    return () => abort.current?.abort();
  }, []);

  const show = (r: Loaded) => {
    if (r.ok) {
      setCandles(r.candles);
      setLabel(r.label);
      setError('');
    } else {
      setError(r.error);
    }
  };

  const onProvider = (id: string) => {
    const p = getProvider(id);
    setProviderId(id);
    setSymbol(p.defaultSymbol);
    setTimeframe(p.defaultTimeframe);
  };

  const loadMarket = async () => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    const r = await loadFromProvider(provider, { symbol: symbol.trim(), timeframe, bars: BARS }, ctl.signal);
    if (ctl.signal.aborted) return;
    setBusy(false);
    show(r);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      show(loadFromCsv(await file.text(), file.name));
    } catch (e) {
      setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onDataset = (id: string) => {
    setDatasetId(id);
    const d = library.find((x) => x.id === id);
    if (d) show(loadFromDataset(d));
  };

  return (
    <div className="sm-page">
      <header className="sm-head">
        <h1>Strategy maker</h1>
        <p>Pick a market, a saved dataset or a CSV file to look at its candles. Everything stays in this browser.</p>
      </header>
      <section className="sm-picker" aria-label="Data">
        <div className="sm-group">
          <label>
            Provider
            <select value={providerId} onChange={(e) => onProvider(e.target.value)}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Symbol
            <input list="sm-symbols" value={symbol} onChange={(e) => setSymbol(e.target.value)} spellCheck={false} />
            <datalist id="sm-symbols">
              {provider.popularSymbols.map((s) => (
                <option key={s.symbol} value={s.symbol}>
                  {s.label}
                </option>
              ))}
            </datalist>
          </label>
          <label>
            Timeframe
            <select value={timeframe} onChange={(e) => setTimeframe(e.target.value as Timeframe)}>
              {provider.timeframes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void loadMarket()} disabled={busy || !symbol.trim()}>
            {busy ? 'Loading...' : 'Load market'}
          </button>
        </div>
        <div className="sm-group">
          {library.length ? (
            <label>
              Saved dataset
              <select value={datasetId} onChange={(e) => onDataset(e.target.value)}>
                <option value="">Choose...</option>
                {library.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span className="sm-note">No saved datasets.</span>
          )}
          <label>
            CSV file
            <input type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
        </div>
      </section>
      {error && (
        <p className="sm-error" role="alert">
          {error}
        </p>
      )}
      <main className="sm-main">
        {candles.length ? (
          <>
            <div className="sm-label">
              {label} - {candles.length} candles
            </div>
            <CandleChart candles={candles} />
          </>
        ) : (
          <div className="sm-empty">No candles yet. Load a market, a saved dataset or a CSV file.</div>
        )}
      </main>
    </div>
  );
}
