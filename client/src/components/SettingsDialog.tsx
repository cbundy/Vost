import { useStore } from '../state/store';
import type { HistoryLoading } from '../lib/historyPaging';
import { Modal } from './Modal';

const HISTORY_OPTIONS: { value: HistoryLoading; label: string; hint: string }[] = [
  { value: 'scroll', label: 'Load as you scroll back', hint: 'Older bars load in pages as you scroll or zoom back.' },
  { value: 'all', label: 'Load all bars at once', hint: 'The Number of bars menu sets how many bars load; nothing pages in later.' },
];

/** A settings section: a heading and its rows. A later setting adds a section or a row here, not a new dialog. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const historyLoading = useStore((s) => s.historyLoading);
  const setHistoryLoading = useStore((s) => s.setHistoryLoading);
  return (
    <Modal title="Settings" onClose={onClose} width={460}>
      <Section title="Charts">
        <fieldset className="settings-row">
          <legend>Chart history</legend>
          {HISTORY_OPTIONS.map((o) => (
            <label key={o.value} className="settings-radio">
              <input type="radio" name="historyLoading" value={o.value} checked={historyLoading === o.value} onChange={() => setHistoryLoading(o.value)} />
              <span>
                <span className="settings-radio-label">{o.label}</span>
                <span className="hint settings-radio-hint">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Section>
    </Modal>
  );
}
