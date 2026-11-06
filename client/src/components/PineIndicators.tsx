import { useCallback, useEffect, useState } from 'react';
import { fmtTime } from '../lib/format';
import { useChart } from '../state/chartContext';
import { useStore } from '../state/store';
import { Modal } from './Modal';

interface Stored {
  scriptId: string;
  name: string;
  author: string;
  licence: string | null;
  fetchedAt: number;
  pineVersion: number | null;
}

interface Hit {
  scriptId: string;
  name: string;
  author: string;
  plots: number | null;
  stored: boolean;
}

const BASE = '/api/pine/indicators';
const LINK_RE = /^https:\/\/www\.tradingview\.com\/script\/[A-Za-z0-9]+/;

/** The server's words for a failed call (closed-source, not an indicator, unreachable, not writable). */
async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === 'string' ? body.error : `The server answered HTTP ${res.status}`;
}

const reach = (err: unknown) => `Could not reach the Vost server: ${err instanceof Error ? err.message : String(err)}`;

/**
 * The TradingView indicators dialog: search TradingView (through the Vost server) or paste a script link,
 * add an open-source indicator, and open, inspect or remove the ones the server keeps.
 */
export function PineIndicators({ onClose }: { onClose: () => void }) {
  const addIndicator = useChart((s) => s.addIndicator);
  const setPineDraft = useChart((s) => s.setPineDraft);
  const applyPineDraft = useChart((s) => s.applyPineDraft);
  const openPineEditor = useStore((s) => s.openPineEditor);
  const [stored, setStored] = useState<Stored[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(BASE);
      if (!res.ok) throw new Error(await errorOf(res));
      setStored(((await res.json()) as { indicators: Stored[] }).indicators);
      setLoadError('');
    } catch (err) {
      setLoadError(`Could not load the list: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const search = async () => {
    const q = query.trim();
    if (!q) return setError('Type a name to search for');
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}`);
      if (!res.ok) return setError(await errorOf(res));
      setHits(((await res.json()) as { results: Hit[] }).results);
    } catch (err) {
      setError(reach(err));
    } finally {
      setBusy(false);
    }
  };

  const add = async (body: { scriptId: string } | { link: string }) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(BASE, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) return setError(await errorOf(res));
      const added = (await res.json()) as Stored;
      setHits((h) => h && h.map((x) => (x.scriptId === added.scriptId ? { ...x, stored: true } : x)));
      if ('link' in body) setLink('');
      await refresh();
    } catch (err) {
      setError(reach(err));
    } finally {
      setBusy(false);
    }
  };

  const addLink = () => {
    const l = link.trim();
    if (!LINK_RE.test(l)) return setError('The link must look like https://www.tradingview.com/script/<id>/');
    void add({ link: l });
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) return setError(await errorOf(res));
      setHits((h) => h && h.map((x) => (x.scriptId === id ? { ...x, stored: false } : x)));
      await refresh();
    } catch (err) {
      setError(reach(err));
    } finally {
      setBusy(false);
    }
  };

  const openInEditor = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/${encodeURIComponent(id)}`);
      if (!res.ok) return setError(await errorOf(res));
      const { source } = (await res.json()) as { source: string };
      const chartId = addIndicator('pine');
      setPineDraft(chartId, source);
      applyPineDraft(chartId);
      openPineEditor(chartId);
      onClose();
    } catch (err) {
      setError(reach(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="TradingView indicators" onClose={onClose} width={760}>
      <p className="muted-2 pine-libs-hint">
        The Vost server searches TradingView, fetches an open-source indicator and keeps a copy with its author and licence; your browser never contacts TradingView. Closed-source scripts cannot be added. These are TradingView&apos;s own web endpoints, not an official API, so they may change.
      </p>
      <h3 className="pine-libs-sub">Search TradingView</h3>
      <form
        className="pine-ind-row"
        onSubmit={(ev) => {
          ev.preventDefault();
          void search();
        }}
      >
        <input type="text" value={query} placeholder="Name, for example Supertrend" aria-label="Search TradingView" spellCheck={false} onChange={(ev) => setQuery(ev.target.value)} />
        <button type="submit" disabled={busy}>
          Search
        </button>
      </form>
      {hits && (
        <ul className="pine-libs-list pine-ind-list" aria-label="Search results">
          {hits.length === 0 && <li className="muted-2">No open-source indicators found.</li>}
          {hits.map((h) => (
            <li key={h.scriptId}>
              <span className="pine-ind-name">{h.name}</span>
              <span className="muted-2">by {h.author}</span>
              {h.plots !== null && <span className="muted-2">{h.plots} {h.plots === 1 ? 'plot' : 'plots'}</span>}
              <span className="pine-libs-spacer" />
              {h.stored ? (
                <span className="badge blue">Added</span>
              ) : (
                <button className="ghost" disabled={busy} onClick={() => void add({ scriptId: h.scriptId })} aria-label={`Add ${h.name} by ${h.author}`}>
                  Add
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <h3 className="pine-libs-sub">Or paste a link</h3>
      <form
        className="pine-ind-row"
        onSubmit={(ev) => {
          ev.preventDefault();
          addLink();
        }}
      >
        <input type="text" value={link} placeholder="https://www.tradingview.com/script/..." aria-label="Script link" spellCheck={false} onChange={(ev) => setLink(ev.target.value)} />
        <button type="submit" disabled={busy || link.trim() === ''}>
          Add link
        </button>
      </form>
      {error && <div className="pine-error" role="alert">{error}</div>}
      <h3 className="pine-libs-sub">Added indicators</h3>
      {loadError && <div className="pine-error" role="alert">{loadError}</div>}
      <ul className="pine-libs-list pine-ind-list" aria-label="Added indicators">
        {stored?.length === 0 && <li className="muted-2">No TradingView indicators added yet.</li>}
        {stored?.map((s) => (
          <li key={s.scriptId}>
            <div className="pine-ind-main">
              <div>
                <span className="pine-ind-name">{s.name}</span> <span className="muted-2">by {s.author}</span>
                {s.pineVersion !== null && s.pineVersion < 5 && <span className="badge amber" title="The Pine editor offers Convert to v6 for it">Pine v{s.pineVersion}, convert to v6</span>}
              </div>
              <div className="muted-2 pine-ind-licence">{s.licence ? s.licence.split('\n')[0] : 'No licence text'}</div>
              <div className="muted-2">Added {fmtTime(s.fetchedAt / 1000, { dateOnly: true })}</div>
            </div>
            <button className="ghost" disabled={busy} onClick={() => void openInEditor(s.scriptId)} aria-label={`Open ${s.name} in editor`}>
              Open in editor
            </button>
            <button className="ghost" disabled={busy} onClick={() => void remove(s.scriptId)} aria-label={`Remove ${s.name}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
