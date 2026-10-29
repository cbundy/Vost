import { useState } from 'react';
import { MAX_LAYOUT_NAME, cleanName } from '../lib/savedLayouts';
import { Modal } from './Modal';

/** Asks for a layout name (copy, rename and create share it): trimmed, not empty, at most 64 characters. */
export function LayoutNameDialog({ title, initial, okLabel, onSubmit, onClose }: { title: string; initial: string; okLabel: string; onSubmit: (name: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const name = cleanName(text);
  const submit = () => {
    if (name) onSubmit(name);
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={400}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={submit} disabled={!name}>
            {okLabel}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input className="lm-name-input" value={text} maxLength={MAX_LAYOUT_NAME} onChange={(e) => setText(e.target.value)} aria-label="Layout name" autoFocus onFocus={(e) => e.target.select()} />
      </form>
    </Modal>
  );
}
