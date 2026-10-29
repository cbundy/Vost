import { useCallback, useEffect, useState } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { PineEditor } from './PineEditor';

interface Stored {
  path: string;
  origin: 'tradingview' | 'pasted';
  fetchedAt: number;
  bytes: number;
}

const BASE = '/api/pine/libraries';
const urlFor = (libPath: string) => `${BASE}/${libPath.split('/').map(encodeURIComponent).join('/')}`;
const PATH_RE = /^[A-Za-z0-9_.-]{1,64}\/[A-Za-z_][A-Za-z0-9_]{0,63}\/[1-9][0-9]{0,5}$/;

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof body.error === 'string' ? body.error : `The server answered HTTP ${res.status}`;
}

/**
 * The Pine libraries dialog: the libraries the server keeps (fetched from TradingView or pasted) and a form to
 * paste one. Saving or removing one re-runs every Pine indicator.
 */
export function PineLibraries({ initialPath = '', onClose }: { initialPath?: string; onClose: () => void }) {
  const indicators = useStore((s) => s.indicators);
  const updateIndicator = useStore((s) => s.updateIndicator);
  const [stored, setStored] = useState<Stored[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [libPath, setLibPath] = useState(initialPath);
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(BASE);
      if (!res.ok) throw new Error(await errorOf(res));
      setStored(((await res.json()) as { libraries: Stored[] }).libraries);
      setLoadError('');
    } catch (err) {
      setLoadError(`Could not load the list: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  const rerun = () => {
    for (const i of indicators) if (i.kind === 'pine') updateIndicator(i.id, { inputs: {} });
  };

  const save = async () => {
    const p = libPath.trim();
    if (!PATH_RE.test(p)) return setError('The path must be user/name/version, for example TradingView/ta/7');
    setBusy(true);
    setError('');
    try {
      const res = await fetch(urlFor(p), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source }) });
      if (!res.ok) return setError(await errorOf(res));
      setSource('');
      setLibPath('');
      await refresh();
      rerun();
    } catch (err) {
      setError(`Could not reach the Vost server: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: string) => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(urlFor(p), { method: 'DELETE' });
      if (!res.ok && res.status !== 404) return setError(await errorOf(res));
      await refresh();
      rerun();
    } catch (err) {
      setError(`Could not reach the Vost server: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Pine libraries" onClose={onClose} width={720}>
      <p className="muted-2 pine-libs-hint">
        Scripts that <code>import user/name/version</code> a TradingView library get it from the Vost server, which fetches open-source libraries and keeps a copy. For a closed-source library, or when TradingView cannot be reached, paste its source below.
      </p>
      {loadError && <div className="pine-error" role="alert">{loadError}</div>}
      <ul className="pine-libs-list" aria-label="Stored libraries">
        {stored?.length === 0 && <li className="muted-2">No libraries stored yet.</li>}
        {stored?.map((l) => (
          <li key={l.path}>
            <span className="pine-libs-path">{l.path}</span>
            <span className={`badge ${l.origin === 'pasted' ? 'amber' : 'blue'}`}>{l.origin === 'pasted' ? 'Pasted' : 'TradingView'}</span>
            <span className="pine-libs-spacer" />
            <button className="ghost" disabled={busy} onClick={() => void remove(l.path)} aria-label={`Remove ${l.path}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <h3 className="pine-libs-sub">Paste a library</h3>
      <label className="pine-libs-field">
        Path
        <input type="text" value={libPath} placeholder="user/name/version" spellCheck={false} onChange={(ev) => setLibPath(ev.target.value)} />
      </label>
      <div className="pine-libs-editor">
        <PineEditor value={source} onChange={setSource} ariaLabel="Library source" minHeight={180} />
      </div>
      {error && <div className="pine-error" role="alert">{error}</div>}
      <div className="pine-libs-actions">
        <button className="primary" disabled={busy || source.trim() === ''} onClick={() => void save()}>
          Save library
        </button>
      </div>
    </Modal>
  );
}
