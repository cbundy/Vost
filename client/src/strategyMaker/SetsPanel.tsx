import { useState } from 'react';

export interface SetRow {
  id: string;
  /** What to show: the user's name, or the source's own label. */
  name: string;
  trades: number;
  updatedAt: number;
}

interface Props {
  rows: SetRow[];
  /** The set on the chart now. */
  openId: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onExport: () => void;
  onImport: (file: File | undefined) => void;
}

const when = (t: number): string => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function SetsPanel({ rows, openId, busy, onOpen, onRename, onDelete, onExport, onImport }: Props) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const save = (): void => {
    if (editing && editing.text.trim()) onRename(editing.id, editing.text.trim());
    setEditing(null);
  };
  return (
    <section className="sm-sets" aria-label="Sets">
      <h2>Sets</h2>
      {rows.length === 0 ? (
        <p className="sm-note">No saved sets yet. Marked trades are saved here as you draw them.</p>
      ) : (
        <ul className="sm-set-list">
          {rows.map((r) => (
            <li key={r.id} className={r.id === openId ? 'sm-set-open' : undefined}>
              <div className="sm-set-main">
                {editing?.id === r.id ? (
                  <input
                    aria-label={`Name of ${r.name}`}
                    value={editing.text}
                    autoFocus
                    onChange={(e) => setEditing({ id: r.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') save();
                      else if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                ) : (
                  <strong>{r.name}</strong>
                )}
                <span className="sm-bars">
                  {r.trades} trade{r.trades === 1 ? '' : 's'} - changed {when(r.updatedAt)}
                  {r.id === openId ? ' - on the chart' : ''}
                </span>
              </div>
              <div className="sm-set-actions">
                {editing?.id === r.id ? (
                  <>
                    <button type="button" onClick={save}>
                      Save name
                    </button>
                    <button type="button" onClick={() => setEditing(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => onOpen(r.id)} disabled={busy} aria-label={`Open ${r.name}`}>
                      Open
                    </button>
                    <button type="button" onClick={() => setEditing({ id: r.id, text: r.name })} aria-label={`Rename ${r.name}`}>
                      Rename
                    </button>
                    <button type="button" onClick={() => onDelete(r.id)} aria-label={`Delete ${r.name}`}>
                      Delete
                    </button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="sm-set-exchange">
        <button type="button" onClick={onExport}>
          Export
        </button>
        <label className="sm-import">
          Import
          <input type="file" accept=".json,application/json" onChange={(e) => {
            onImport(e.target.files?.[0]);
            e.target.value = '';
          }} />
        </label>
        <span className="sm-note">Export saves every set and the model as one file; Import merges such a file into this browser.</span>
      </div>
    </section>
  );
}
