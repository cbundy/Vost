import { Modal } from './Modal';

/** Shown before leaving a layout with unsaved changes while autosave is off. */
export function UnsavedLayoutDialog({ name, onSave, onDiscard, onClose }: { name: string; onSave: () => void; onDiscard: () => void; onClose: () => void }) {
  return (
    <Modal
      title="Unsaved changes"
      onClose={onClose}
      width={420}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button onClick={onDiscard}>Don't save</button>
          <button className="primary" onClick={onSave} autoFocus>
            Save
          </button>
        </>
      }
    >
      <p className="lm-text">
        "{name}" has changes you have not saved. Save them before you leave it?
      </p>
    </Modal>
  );
}
