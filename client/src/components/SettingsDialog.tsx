import { useStore } from '../state/store';
import type { HistoryLoading } from '../lib/historyPaging';
import { Modal } from './Modal';

const PINE_OPTIONS: { value: 'forming' | 'finished'; label: string; hint: string }[] = [
  { value: 'forming', label: 'Follow the forming bar (as TradingView)', hint: 'A script that declares a higher timeframe follows its unfinished bar live.' },
  { value: 'finished', label: 'Only finished bars (no repaint)', hint: 'A script that declares a higher timeframe uses only its finished bars, so live values match a reload.' },
];

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
  const pineHigherBars = useStore((s) => s.pineHigherBars);
  const setPineHigherBars = useStore((s) => s.setPineHigherBars);
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
      <Section title="Pine scripts">
        <fieldset className="settings-row">
          <legend>Higher timeframes on the live bar</legend>
          {PINE_OPTIONS.map((o) => (
            <label key={o.value} className="settings-radio">
              <input type="radio" name="pineHigherBars" value={o.value} checked={pineHigherBars === o.value} onChange={() => setPineHigherBars(o.value)} />
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
