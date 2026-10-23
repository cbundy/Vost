import { useEffect } from 'react';
import { useStore } from '../state/store';
import { Modal } from './Modal';

export function Inbox({ onClose }: { onClose: () => void }) {
  const messages = useStore((s) => s.messages);
  const markRead = useStore((s) => s.markMessagesRead);
  const clear = useStore((s) => s.clearMessages);

  useEffect(() => {
    markRead();
  }, [markRead, messages.length]);

  const sorted = [...messages].reverse();
  return (
    <Modal
      title="Inbox"
      onClose={onClose}
      width={640}
      footer={
        <>
          <button onClick={clear} disabled={messages.length === 0}>
            Clear all
          </button>
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      {sorted.length === 0 ? (
        <div className="inbox-empty">No messages.</div>
      ) : (
        <ul className="inbox-list">
          {sorted.map((m) => (
            <li key={m.id} className={`inbox-item ${m.severity}`}>
              <div className="inbox-meta">
                <span className="inbox-time">{new Date(m.time).toLocaleTimeString()}</span>
                <span className="inbox-source">{m.source}</span>
                <span className="inbox-sev">{m.severity}</span>
              </div>
              <div className="inbox-text">{m.text}</div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
