import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Candle, Timeframe } from '../../../shared/market.ts';
import { downloadFile } from '../lib/export';
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
import type { TradeStyleLabel } from './engine';
import { styleKey } from './StyleBlock';
import { serverJobs } from '../lib/serverJobs';
import { finishedNote, planReattach, type JobKeeper, type ReattachPlan } from './reattach';
import { MODEL_ID, openStore, setId, whyNotSaved, type FindForm, type HighlightSet, type SetSource, type Store } from './store';
import { buildExport, EXPORT_FILE, parseExchange, planImport, setsToWrite, setStamp, type ImportPlan } from './exchange';
import { SetsPanel, type SetRow } from './SetsPanel';
import { ImportConflicts, SavedModel } from './SavedModel';
import { useModel } from './useModel';
import { TradeList } from './TradeList';
import { Results } from './Results';
import { TargetsForm, type SetChoice } from './TargetsForm';
import { blocker, defaultForm, readForm, sanitizeForm } from './form';
import { sourceLabel } from './run';
import { useFind } from './useFind';
import { SweepPanel } from './SweepPanel';
import { loadFromCsv, loadFromDataset, loadFromProvider, readLibrary, PROVIDER_BARS, type Loaded } from './data';
import './strategyMaker.css';

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
  /** Why marks are not being saved, once `storeState` is 'none'. */
  const [storeWhy, setStoreWhy] = useState(whyNotSaved(null));
  /** A write failed: the page then says why, and the brush keeps working. */
  const storeFailed = useCallback((e: unknown) => {
    setStoreWhy(whyNotSaved(e));
    setStoreState('none');
  }, []);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sources, setSources] = useState<Record<string, SetSource>>({});
  const [form, setForm] = useState<FindForm>(defaultForm);
  const formReady = useRef(false);
  const store = useRef<Store | null>(null);
  const model = useModel();
  /** The record of the server job a run waits for; writes go one after the other so a clear never overtakes a put. */
  const jobWrites = useRef<Promise<unknown>>(Promise.resolve());
  const keeper = useMemo<JobKeeper>(
    () => ({
      put: (rec) => void (jobWrites.current = jobWrites.current.then(() => store.current?.putJob(rec)).catch(() => undefined)),
      clear: () => void (jobWrites.current = jobWrites.current.then(() => store.current?.deleteJob()).catch(() => undefined)),
    }),
    [],
  );
  const onFallback = useCallback(
    (reason: string) => setNote({ error: false, text: `Server jobs unavailable (${reason}); running in the browser` }),
    [],
  );
  const [sweepPlan, setSweepPlan] = useState<ReattachPlan | null>(null);
  const find = useFind(
    PROVIDER_BARS,
    library,
    (result, used, trainedOn) =>
      void (trainedOn ? model.saveRecord(store.current, { id: MODEL_ID, version: 1, result, trainedOn }) : model.save(store.current, result, used)),
    { keeper, onFallback },
  );
  const [saved, setSaved] = useState<HighlightSet[]>([]);
  const savedRef = useRef<HighlightSet[]>([]);
  savedRef.current = saved;
  const lastWrite = useRef<Promise<void>>(Promise.resolve());
  const [importing, setImporting] = useState<{ plan: ImportPlan; choices: Record<string, 'mine' | 'imported'> } | null>(null);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const storeReady = useRef<Promise<void>>(Promise.resolve());
  const baseline = useRef<readonly HighlightTrade[]>(history.present);
  const pending = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadToken = useRef(0);
  const inputsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  candlesRef.current = candles;

  const refreshSaved = useCallback(async (): Promise<HighlightSet[]> => {
    await storeReady.current;
    try {
      const all = (await store.current?.list()) ?? [];
      setSaved(all);
      return all;
    } catch {
      return [];
    }
  }, []);

  /** Writes the pending marks now; `leaving` sends them as the page goes away (a small body goes out as a keepalive request). */
  const flush = useCallback((leaving = false) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const p = pending.current;
    pending.current = null;
    const st = store.current;
    if (!p || !st) return;
    const id = setId(p.source);
    const name = savedRef.current.find((x) => x.id === id)?.name;
    const rec = {
      id,
      version: 1 as const,
      source: p.source,
      trades: p.trades,
      updatedAt: Date.now(),
      ...(name ? { name } : {}),
      ...(p.source.kind === 'csv' ? { candles: p.candles } : {}),
    };
    setCounts((c) => ({ ...c, [id]: p.trades.length }));
    lastWrite.current = (p.trades.length || p.source.kind === 'csv' ? st.put(rec, { keepalive: leaving }) : st.delete(id, { keepalive: leaving })).then(
      () => void refreshSaved(),
      storeFailed,
    );
  }, [refreshSaved, storeFailed]);

  useEffect(() => {
    document.title = 'Strategy maker - Vost';
    let gone = false;
    const onHide = () => flush(true);
    window.addEventListener('pagehide', onHide);
    storeReady.current = openStore({
      onMoved: (m) =>
        setNote({
          error: false,
          text: `Moved ${m.sets} set${m.sets === 1 ? '' : 's'} from this browser to the server.${m.files.length ? ` What the server already held differently was kept aside in ${m.files.join(', ')} in its data folder.` : ''}`,
        }),
    }).then(async (st) => {
      if (gone) return st?.close();
      store.current = st;
      setStoreState(st ? 'ok' : 'none');
      if (!st) return;
      try {
        const all = await st.list();
        if (!gone) {
          setSaved(all);
          setCounts((c) => ({ ...Object.fromEntries(all.map((x) => [x.id, x.trades.length])), ...c }));
          setSources((m) => ({ ...Object.fromEntries(all.map((x) => [x.id, x.source])), ...m }));
        }
      } catch {
        /* the counter then shows this chart only */
      }
      if (!gone) await model.load(st);
      try {
        const rec = await st.getInputs();
        if (!gone && rec) setForm(sanitizeForm(rec.form));
      } catch {
        /* the form keeps its defaults */
      }
      if (!gone) formReady.current = true;
      if (gone) return;
      // The run the page was waiting for when it was last closed: follow it, show it or forget it.
      const plan = await planReattach(st, serverJobs);
      if (gone || plan.action === 'none' || plan.action === 'keep') return;
      if (plan.action === 'drop') return keeper.clear();
      if (plan.action === 'show') setNote({ error: false, text: finishedNote(plan.record.kind) });
      if (plan.record.kind === 'sweep') return setSweepPlan(plan);
      const sets = await st.list().catch(() => [] as HighlightSet[]);
      void find.adopt(plan, sets);
    });
    return () => {
      gone = true;
      window.removeEventListener('pagehide', onHide);
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
    timer.current = setTimeout(() => flush(), SAVE_DELAY_MS);
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
  const findResult = find.result;
  const tradeStyles = useMemo(() => {
    const m = new Map<string, { style: TradeStyleLabel; reason: string }>();
    if (!findResult || findResult.outcome.kind !== 'ok' || !findResult.outcome.style) return m;
    const at = findResult.usedSets.findIndex((u) => u.id === id);
    for (const t of findResult.outcome.style.trades) if (t.series === at) m.set(styleKey(t.side, t.entryTime), t);
    return m;
  }, [findResult, id]);
  const total = Object.entries(counts).reduce((n, [k, v]) => (k === id ? n : n + v), 0) + trades.length;

  /** Puts the saved marks of a set on the chart, unless another chart was loaded meanwhile. */
  const loadMarks = (sid: string, token: number) =>
    void (async () => {
      let marks: HighlightTrade[] = [];
      await storeReady.current;
      try {
        marks = (await store.current?.get(sid))?.trades ?? [];
      } catch {
        setStoreState('none');
      }
      if (token !== loadToken.current) return;
      baseline.current = marks;
      setHistory(emptyHistory(marks));
      setCounts((c) => ({ ...c, [sid]: marks.length }));
    })();

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
      loadMarks(setId(src), token);
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

  const fetchMarket = async (pid: string, sym: string, tf: string) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(true);
    const r = await loadFromProvider(getProvider(pid), { symbol: sym, timeframe: tf as Timeframe, bars: PROVIDER_BARS }, ctl.signal);
    if (ctl.signal.aborted) return;
    setBusy(false);
    show(r, { kind: 'provider', provider: pid, symbol: sym, timeframe: tf });
  };
  const loadMarket = () => fetchMarket(providerId, symbol.trim(), timeframe);

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
  const names = useMemo(() => Object.fromEntries(saved.filter((x) => x.name).map((x) => [x.id, x.name as string])), [saved]);
  const nameOf = (k: string): string => names[k] || (sources[k] ? sourceLabel(sources[k], datasetName) : k);
  const setChoices: SetChoice[] = Object.entries({ ...counts, ...(id ? { [id]: trades.length } : {}) })
    .filter(([k, n]) => n > 0 && sources[k])
    .map(([k, n]) => ({ id: k, label: nameOf(k), count: n }));
  const chosen = form.setIds ? form.setIds.filter((k) => setChoices.some((c) => c.id === k)) : id && setChoices.some((c) => c.id === id) ? [id] : setChoices.map((c) => c.id);
  const chosenTrades = setChoices.filter((c) => chosen.includes(c.id)).reduce((n, c) => n + c.count, 0);
  const { inputs, errors } = readForm(form);

  // The model is up to date when it was trained on exactly the chosen sets, with the marks they have now (the open chart counts as drawn).
  const liveStamp = useMemo(
    () => (source ? setStamp({ source, trades, candles: source.kind === 'csv' ? candles : undefined }) : null),
    [source, trades, candles],
  );
  const stamps = useMemo(() => Object.fromEntries(saved.map((x) => [x.id, setStamp(x)])), [saved]);
  const freshness = model.freshness(
    chosen.map((k) => ({ id: k, stamp: (k === id ? liveStamp : stamps[k]) ?? '' })),
    new Set(setChoices.map((c) => c.id)),
    nameOf,
  );

  /** The chosen sets as they are now: the open chart with its marks as drawn, the others as saved. */
  const gatherSets = async (): Promise<HighlightSet[]> => {
    let list: HighlightSet[] = [];
    try {
      await storeReady.current;
      list = (await store.current?.list()) ?? [];
    } catch {
      /* only the open chart is then available */
    }
    return chosen.flatMap((k): HighlightSet[] => {
      if (k === id && source) {
        return [{ id: k, version: 1, source, trades: [...trades], updatedAt: Date.now(), ...(source.kind === 'csv' ? { candles } : {}) }];
      }
      return list.filter((x) => x.id === k && x.trades.length);
    });
  };

  const onFind = async () => {
    if (blocker(errors, inputs.families, chosenTrades)) return;
    const sets = await gatherSets();
    // Up to date: reuse it, with the sets in the order it was trained on so the skipped-trade indexes line up.
    const rec = model.record;
    const ordered = rec && freshness?.upToDate ? rec.trainedOn.map((t) => sets.find((x) => x.id === t.id)) : [];
    if (rec && ordered.length === sets.length && ordered.every((x) => x)) void find.start(ordered as HighlightSet[], inputs, rec.result);
    else void find.start(sets, inputs);
  };

  const onRetrain = async () => void find.retrain(await gatherSets());

  /* ------------------------------ the Sets panel ------------------------------ */

  const rows: SetRow[] = saved
    .filter((x) => x.trades.length > 0 || x.source.kind === 'csv')
    .map((x) => ({ id: x.id, name: x.name || sourceLabel(x.source, datasetName), trades: x.id === id ? trades.length : x.trades.length, updatedAt: x.updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);

  const onOpenSet = async (sid: string) => {
    const set = saved.find((x) => x.id === sid);
    if (!set) return;
    const src = set.source;
    try {
      if (src.kind === 'provider') {
        setProviderId(src.provider);
        setSymbol(src.symbol);
        setTimeframe(src.timeframe as Timeframe);
        await fetchMarket(src.provider, src.symbol, src.timeframe);
      } else if (src.kind === 'library') {
        const d = library.find((x) => x.id === src.datasetId);
        if (!d) return setError('This dataset is no longer in the library.');
        setDatasetId(d.id);
        show(loadFromDataset(d), src);
      } else if (set.candles?.length) {
        show({ ok: true, candles: set.candles, label: src.name }, src);
      } else {
        setError('The candles of this file were not kept.');
      }
    } catch (e) {
      setBusy(false);
      setError(`Could not open this set: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onRename = async (sid: string, name: string) => {
    await storeReady.current;
    flush();
    await lastWrite.current;
    try {
      const set = await store.current?.get(sid);
      if (set) await store.current?.put({ ...set, name });
    } catch (e) {
      storeFailed(e);
    }
    await refreshSaved();
  };

  const onDeleteSet = async (sid: string) => {
    const row = rows.find((r) => r.id === sid);
    if (!row || !window.confirm(`Delete ${row.name} and its ${row.trades} marked trades?`)) return;
    // A delayed save must not bring the set back.
    if (pending.current && setId(pending.current.source) === sid) {
      pending.current = null;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    }
    if (sid === id) {
      baseline.current = NO_TRADES;
      setHistory(emptyHistory(NO_TRADES));
    }
    setCounts((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== sid)));
    await lastWrite.current;
    try {
      await store.current?.delete(sid);
    } catch (e) {
      storeFailed(e);
    }
    await refreshSaved();
  };

  const onExport = async () => {
    setNote(null);
    await storeReady.current;
    const st = store.current;
    if (!st) return setNote({ error: true, text: `${storeWhy}, so there is nothing to export.` });
    flush();
    await lastWrite.current;
    try {
      const sets = await st.list();
      downloadFile(EXPORT_FILE, JSON.stringify(buildExport(sets, (await st.getModel()) ?? null)), 'application/json');
      setNote({ error: false, text: `Exported ${sets.length} set${sets.length === 1 ? '' : 's'}${model.record ? ' and the model' : ''} to ${EXPORT_FILE}.` });
    } catch (e) {
      setNote({ error: true, text: `Could not export: ${e instanceof Error ? e.message : String(e)}` });
    }
  };

  const commitImport = async (plan: ImportPlan, choices: Record<string, 'mine' | 'imported'>) => {
    const st = store.current;
    if (!st) return;
    const sets = setsToWrite(plan, choices);
    setImporting(null);
    if (!sets.length && !plan.model && !plan.conflicts.length) return setNote({ error: false, text: 'Nothing to import: everything in the file is already here.' });
    try {
      if (sets.length || plan.model) await st.importAll(sets, plan.model);
    } catch (e) {
      return setNote({ error: true, text: `Nothing was imported: ${e instanceof Error ? e.message : String(e)}` });
    }
    const all = await refreshSaved();
    setCounts((c) => ({ ...c, ...Object.fromEntries(all.map((x) => [x.id, x.trades.length])) }));
    setSources((m) => ({ ...m, ...Object.fromEntries(all.map((x) => [x.id, x.source])) }));
    if (plan.model) model.setRecord(plan.model);
    if (id && sets.some((x) => x.id === id)) loadMarks(id, ++loadToken.current);
    const replaced = sets.length - plan.add.length;
    setNote({
      error: false,
      text: `Imported ${plan.add.length} new set${plan.add.length === 1 ? '' : 's'}, replaced ${replaced}, kept ${plan.conflicts.length - replaced} of yours${plan.model ? ', and the model' : ''}.`,
    });
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    setNote(null);
    setImporting(null);
    let text: string;
    try {
      text = await file.text();
    } catch (e) {
      return setNote({ error: true, text: `Could not read ${file.name}: ${e instanceof Error ? e.message : String(e)}` });
    }
    const parsed = parseExchange(text);
    if (!parsed.ok) return setNote({ error: true, text: `Nothing was imported. ${parsed.error}` });
    await storeReady.current;
    const st = store.current;
    if (!st) return setNote({ error: true, text: `${storeWhy}, so nothing can be imported.` });
    flush();
    await lastWrite.current;
    try {
      const plan = planImport({ sets: await st.list(), model: (await st.getModel()) ?? null }, parsed);
      if (plan.conflicts.length) setImporting({ plan, choices: {} });
      else await commitImport(plan, {});
    } catch (e) {
      setNote({ error: true, text: `Nothing was imported: ${e instanceof Error ? e.message : String(e)}` });
    }
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
        <p>Pick a market, a saved dataset or a CSV file to look at its candles. Your marks and the saved model are kept on the Vost server.</p>
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
              <p className="sm-note sm-warn">{storeWhy}, so your marks will not be kept after you leave the page.</p>
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
                  styles={tradeStyles}
                  onFocus={(t) => setFocus((f) => ({ trade: t, nonce: (f?.nonce ?? 0) + 1 }))}
                  onDelete={(t) => setHistory((h) => commit(h, h.present.filter((x) => x !== t)))}
                />
              </aside>
            </div>
          </>
        ) : (
          <div className="sm-empty">No candles yet. Load a market, a saved dataset or a CSV file.</div>
        )}
        <SetsPanel
          rows={rows}
          openId={id}
          busy={busy}
          onOpen={(sid) => void onOpenSet(sid)}
          onRename={(sid, name) => void onRename(sid, name)}
          onDelete={(sid) => void onDeleteSet(sid)}
          onExport={() => void onExport()}
          onImport={(f) => void onImport(f)}
        />
        {note && (
          <p className={note.error ? 'sm-error' : 'sm-note'} role={note.error ? 'alert' : 'status'}>
            {note.text}
          </p>
        )}
        {importing && (
          <ImportConflicts
            conflicts={importing.plan.conflicts}
            choices={importing.choices}
            name={(k) => names[k] || (sources[k] ? sourceLabel(sources[k], datasetName) : k)}
            onChoose={(k, c) => setImporting((i) => (i ? { ...i, choices: { ...i.choices, [k]: c } } : i))}
            onApply={() => void commitImport(importing.plan, Object.fromEntries(importing.plan.conflicts.map((c) => [c.id, importing.choices[c.id] ?? 'mine'])))}
            onCancel={() => setImporting(null)}
          />
        )}
        {model.record && model.insights && (
          <SavedModel
            result={model.record.result}
            insights={model.insights}
            freshness={freshness}
            running={find.run.running}
            shownBelow={!!find.result && !find.run.running && find.result.outcome.kind === 'ok' && !!freshness?.upToDate}
            onRetrain={() => void onRetrain()}
          />
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
          <Results result={find.result} selected={find.selected} onSelect={(c) => find.select(c, candles)} source={label} />
        )}
        <SweepPanel getClient={find.getClient} keeper={keeper} onFallback={onFallback} reattach={sweepPlan} />
      </main>
    </div>
  );
}
