import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Candle, Timeframe } from '../../../shared/market.ts';
import { getProvider, providers } from '../lib/providers';
import { BrushToolbar } from './BrushToolbar';
import { CandleChart, type FocusRequest } from './CandleChart';
import {
  applyStroke,
  commit,
  emptyHistory,
  MIN_TRADES,
  redo,
  undo,
  type HighlightTrade,
  type History,
  type Side,
  type Tool,
} from './brush';
import { openStore, setId, type FindForm, type HighlightSet, type SetSource, type Store } from './store';
import { TradeList } from './TradeList';
import { Results } from './Results';
import { TargetsForm, type SetChoice } from './TargetsForm';
import { blocker, defaultForm, readForm, sanitizeForm } from './form';
import { sourceLabel } from './run';
import { useFind } from './useFind';
import { loadFromCsv, loadFromDataset, loadFromProvider, readLibrary, type Loaded } from './data';
import './strategyMaker.css';

const BARS = 1000;
const SAVE_DELAY_MS = 400;
const NO_TRADES: readonly HighlightTrade[] = [];
const SAVE_INPUTS_MS = 400;

/** The marks waiting to be written to the store. */
interface Pending {
  source: SetSource;
  trades: HighlightTrade[];
  candles: Candle[];
}

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return !!el && (['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable);
};

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

  const [tool, setTool] = useState<Tool | null>(null);
  const lastSide = useRef<Side>('long');
  const [history, setHistory] = useState<History>(emptyHistory(NO_TRADES));
  const [source, setSource] = useState<SetSource | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [storeState, setStoreState] = useState<'pending' | 'ok' | 'none'>('pending');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sources, setSources] = useState<Record<string, SetSource>>({});
  const [form, setForm] = useState<FindForm>(defaultForm);
  const formReady = useRef(false);
  const find = useFind(BARS, library);
  const store = useRef<Store | null>(null);
  const storeReady = useRef<Promise<void>>(Promise.resolve());
  const baseline = useRef<readonly HighlightTrade[]>(history.present);
  const pending = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadToken = useRef(0);
  const inputsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  candlesRef.current = candles;

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    const st = store.current;
    if (!p || !st) return;
    const id = setId(p.source);
    const rec = { id, version: 1 as const, source: p.source, trades: p.trades, updatedAt: Date.now(), ...(p.source.kind === 'csv' ? { candles: p.candles } : {}) };
    setCounts((c) => ({ ...c, [id]: p.trades.length }));
    void (p.trades.length || p.source.kind === 'csv' ? st.put(rec) : st.delete(id)).catch(() => setStoreState('none'));
  }, []);

  useEffect(() => {
    document.title = 'Strategy maker - Vost';
    let gone = false;
    storeReady.current = openStore().then(async (st) => {
      if (gone) return st?.close();
      store.current = st;
      setStoreState(st ? 'ok' : 'none');
      if (!st) return;
      try {
        const all = await st.list();
        if (!gone) {
          setCounts((c) => ({ ...Object.fromEntries(all.map((x) => [x.id, x.trades.length])), ...c }));
          setSources((m) => ({ ...Object.fromEntries(all.map((x) => [x.id, x.source])), ...m }));
        }
      } catch {
        /* the counter then shows this chart only */
      }
      try {
        const rec = await st.getInputs();
        if (!gone && rec) setForm(sanitizeForm(rec.form));
      } catch {
        /* the form keeps its defaults */
      }
      if (!gone) formReady.current = true;
    });
    return () => {
      gone = true;
      if (inputsTimer.current) clearTimeout(inputsTimer.current);
      abort.current?.abort();
      flush();
      store.current?.close();
    };
  }, [flush]);

  // Marks changed by the user are written within a moment; marks that were just loaded are not.
  useEffect(() => {
    const untouched = history.past.length === 0 && history.future.length === 0;
    if ((untouched && history.present === baseline.current) || !source) return;
    pending.current = { source, trades: [...history.present], candles: candlesRef.current };
    setSources((m) => (m[setId(source)] ? m : { ...m, [setId(source)]: source }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [history.present, source, flush]);

  // The form is kept in the page's own database a moment after each change, once the saved one has been read.
  useEffect(() => {
    if (!formReady.current) return;
    if (inputsTimer.current) clearTimeout(inputsTimer.current);
    inputsTimer.current = setTimeout(() => void store.current?.putInputs(form).catch(() => undefined), SAVE_INPUTS_MS);
  }, [form]);

  const times = useMemo(() => candles.map((c) => c.time), [candles]);
  const trades = history.present;
  const id = source ? setId(source) : null;
  const total = Object.entries(counts).reduce((n, [k, v]) => (k === id ? n : n + v), 0) + trades.length;

  const show = (r: Loaded, src?: SetSource) => {
    if (r.ok && src) {
      flush();
      const token = ++loadToken.current;
      setCandles(r.candles);
      setLabel(r.label);
      setError('');
      setSource(src);
      setSources((m) => ({ ...m, [setId(src)]: src }));
      setTool(null);
      baseline.current = NO_TRADES;
      setHistory(emptyHistory(NO_TRADES));
      const sid = setId(src);
      void (async () => {
        let saved: HighlightTrade[] = [];
        await storeReady.current;
        try {
          saved = (await store.current?.get(sid))?.trades ?? [];
        } catch {
          setStoreState('none');
        }
        if (token !== loadToken.current) return;
        baseline.current = saved;
        setHistory(emptyHistory(saved));
        setCounts((c) => ({ ...c, [sid]: saved.length }));
      })();
    } else if (r.ok) {
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
    show(r, { kind: 'provider', provider: providerId, symbol: symbol.trim(), timeframe });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      show(loadFromCsv(await file.text(), file.name), { kind: 'csv', name: file.name });
    } catch (e) {
      setError(`Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onDataset = (id: string) => {
    setDatasetId(id);
    const d = library.find((x) => x.id === id);
    if (d) show(loadFromDataset(d), { kind: 'library', datasetId: d.id });
  };

  // Sets with marked trades; the open chart counts as it is now, saved or not.
  const datasetName = (did: string) => library.find((d) => d.id === did)?.name;
  const setChoices: SetChoice[] = Object.entries({ ...counts, ...(id ? { [id]: trades.length } : {}) })
    .filter(([k, n]) => n > 0 && sources[k])
    .map(([k, n]) => ({ id: k, label: sourceLabel(sources[k], datasetName), count: n }));
  const chosen = form.setIds ? form.setIds.filter((k) => setChoices.some((c) => c.id === k)) : id && setChoices.some((c) => c.id === id) ? [id] : setChoices.map((c) => c.id);
  const chosenTrades = setChoices.filter((c) => chosen.includes(c.id)).reduce((n, c) => n + c.count, 0);
  const { inputs, errors } = readForm(form);

  const onFind = async () => {
    if (blocker(errors, inputs.families, chosenTrades)) return;
    let saved: HighlightSet[] = [];
    try {
      await storeReady.current;
      saved = (await store.current?.list()) ?? [];
    } catch {
      /* only the open chart is then available */
    }
    const sets = chosen.flatMap((k): HighlightSet[] => {
      if (k === id && source) {
        return [{ id: k, version: 1, source, trades: [...trades], updatedAt: Date.now(), ...(source.kind === 'csv' ? { candles } : {}) }];
      }
      return saved.filter((x) => x.id === k && x.trades.length);
    });
    void find.start(sets, inputs);
  };

  useEffect(() => find.clearSelection(), [candles]);

  const pickTool = useCallback((t: Tool | null) => {
    if (t?.kind === 'brush') lastSide.current = t.side;
    setTool(t);
  }, []);
  const onUndo = useCallback(() => setHistory(undo), []);
  const onRedo = useCallback(() => setHistory(redo), []);
  const onClear = () => {
    if (trades.length && window.confirm(`Remove all ${trades.length} marked trades on this chart?`)) setHistory((h) => commit(h, []));
  };
  const onStroke = useCallback(
    (a: number, b: number) => {
      if (tool) setHistory((h) => commit(h, applyStroke(h.present, times, tool, a, b)));
    },
    [tool, times],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z') {
        e.preventDefault();
        setHistory(e.shiftKey ? redo : undo);
      } else if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      } else if (k === 'b') {
        setTool((t) => (t?.kind === 'brush' ? null : { kind: 'brush', side: lastSide.current }));
      } else if (k === 'e') {
        setTool((t) => (t?.kind === 'eraser' ? null : { kind: 'eraser' }));
      } else if (k === 'escape') {
        setTool(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
            <div className="sm-tools">
              <BrushToolbar
                tool={tool}
                canUndo={history.past.length > 0}
                canRedo={history.future.length > 0}
                hasTrades={trades.length > 0}
                onTool={pickTool}
                onUndo={onUndo}
                onRedo={onRedo}
                onClear={onClear}
              />
              <div className="sm-count" aria-live="polite">
                <strong>
                  {total} of {MIN_TRADES} trades
                </strong>
                {total < MIN_TRADES ? ` - mark ${MIN_TRADES - total} more` : ' - enough to look for a strategy'}
              </div>
            </div>
            {storeState === 'none' && (
              <p className="sm-note sm-warn">Saving is not available in this browser, so your marks will not be kept after you leave the page.</p>
            )}
            {find.found.length > 0 && (
              <div className="sm-legend" aria-label="Legend">
                <span>
                  <i className="sm-key sm-key-yours" /> Your trades
                </span>
                <span>
                  <i className="sm-key sm-key-found" /> Found trades
                </span>
              </div>
            )}
            <div className="sm-work">
              <CandleChart candles={candles} trades={trades} tool={tool} onStroke={onStroke} focus={focus} foundTrades={find.found} />
              <aside className="sm-side" aria-label="Trades">
                <TradeList
                  trades={trades}
                  times={times}
                  onFocus={(t) => setFocus((f) => ({ trade: t, nonce: (f?.nonce ?? 0) + 1 }))}
                  onDelete={(t) => setHistory((h) => commit(h, h.present.filter((x) => x !== t)))}
                />
              </aside>
            </div>
          </>
        ) : (
          <div className="sm-empty">No candles yet. Load a market, a saved dataset or a CSV file.</div>
        )}
        <TargetsForm
          form={form}
          onChange={setForm}
          sets={setChoices}
          chosen={chosen}
          onChosen={(ids) => setForm((f) => ({ ...f, setIds: ids }))}
          errors={errors}
          trades={chosenTrades}
          run={find.run}
          onFind={() => void onFind()}
          onCancel={find.cancel}
        />
        {find.error && (
          <p className="sm-error" role="alert">
            {find.error}
          </p>
        )}
        {find.result && !find.run.running && (
          <Results result={find.result} selected={find.selected} onSelect={(c) => find.select(c, candles)} />
        )}
      </main>
    </div>
  );
}
