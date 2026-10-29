import { useState } from 'react';
import { activeMarket, search } from '../lib/savedLayouts';
import { useStore } from '../state/store';
import { Modal } from './Modal';

/** Lists every saved layout: search by name, open one by click or Enter, delete the others after a confirmation. */
export function OpenLayoutDialog({ onOpen, onClose }: { onOpen: (id: string) => void; onClose: () => void }) {
  const saved = useStore((s) => s.savedLayouts);
  const deleteLayout = useStore((s) => s.deleteLayout);
  const [text, setText] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  const rows = search(saved, text);

  return (
    <Modal title="Open layout" onClose={onClose} width={460}>
      <input
        className="lm-name-input"
        type="search"
        placeholder="Search layouts"
        aria-label="Search layouts"
        value={text}
        autoFocus
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && rows.length > 0) {
            e.preventDefault();
            onOpen(rows[0].id);
          }
        }}
      />
      <ul className="lm-list">
        {rows.length === 0 && <li className="muted-2">No layout matches.</li>}
        {rows.map((l) => {
          const current = l.id === saved.currentId;
          return (
            <li key={l.id} className={`lm-open-row${current ? ' current' : ''}`}>
              {asking === l.id ? (
                <div className="lm-confirm" role="alert">
                  <span>Delete "{l.name}"?</span>
                  <button onClick={() => setAsking(null)}>Cancel</button>
                  <button
                    className="danger"
                    onClick={() => {
                      deleteLayout(l.id);
                      setAsking(null);
                    }}
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <>
                  <button className="lm-open-main" onClick={() => onOpen(l.id)}>
                    <span className="lm-open-name">{l.name}</span>
                    <span className="lm-sub">
                      {activeMarket(l.layout)} - {l.layout.charts.length} {l.layout.charts.length === 1 ? 'chart' : 'charts'}
                      {current ? ' - current' : ''}
                    </span>
                  </button>
                  <button
                    className="ghost icon"
                    aria-label={`Delete ${l.name}`}
                    title={current ? 'The open layout cannot be deleted' : `Delete ${l.name}`}
                    disabled={current}
                    onClick={() => setAsking(l.id)}
                  >
                    🗑
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
