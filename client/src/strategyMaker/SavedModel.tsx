import type { TrainResult } from './engine';
import type { Conflict, Freshness } from './exchange';
import { ModelBlock } from './Results';

interface ModelProps {
  result: TrainResult;
  /** Rules and importance rebuilt from the model file (see describeModel). */
  insights: Pick<TrainResult, 'rules' | 'importance'>;
  freshness: Freshness | null;
  running: boolean;
  /** True while the results of this model are shown below, so the rules are not shown twice. */
  shownBelow: boolean;
  onRetrain: () => void;
}

/** The model kept on the Vost server, with a notice when new or changed marks have made it out of date. */
export function SavedModel({ result, insights, freshness, running, shownBelow, onRetrain }: ModelProps) {
  const stale = freshness && !freshness.upToDate;
  return (
    <section className="sm-saved" aria-label="Saved model">
      <h2>Saved model</h2>
      {stale && (
        <div className="sm-stale" role="status">
          <p>
            <strong>Model out of date.</strong> {freshness.reasons.join('; ')}.
          </p>
          <button type="button" className="sm-primary" onClick={onRetrain} disabled={running}>
            Retrain
          </button>
        </div>
      )}
      {!stale && <p className="sm-note">Up to date with your marks. Find reuses it and goes straight to the search.</p>}
      {!shownBelow && <ModelBlock model={{ ...result, ...insights }} />}
    </section>
  );
}

interface ConflictProps {
  conflicts: Conflict[];
  choices: Record<string, 'mine' | 'imported'>;
  name: (id: string) => string;
  onChoose: (id: string, c: 'mine' | 'imported') => void;
  onApply: () => void;
  onCancel: () => void;
}

/** One row per set that differs between yours and the imported file. */
export function ImportConflicts({ conflicts, choices, name, onChoose, onApply, onCancel }: ConflictProps) {
  return (
    <section className="sm-conflicts" aria-label="Import conflicts">
      <h3>These sets differ from the file</h3>
      <ul>
        {conflicts.map((c) => (
          <li key={c.id}>
            <div className="sm-set-main">
              <strong>{name(c.id)}</strong>
              <span className="sm-bars">
                Here {c.mine.trades.length} trades, in the file {c.imported.trades.length}
              </span>
            </div>
            <div role="radiogroup" aria-label={`Choice for ${name(c.id)}`} className="sm-conflict-choice">
              {(['mine', 'imported'] as const).map((k) => (
                <label key={k} className="sm-check">
                  <input type="radio" name={`sm-conflict-${c.id}`} checked={(choices[c.id] ?? 'mine') === k} onChange={() => onChoose(c.id, k)} />
                  {k === 'mine' ? 'Keep mine' : 'Use imported'}
                </label>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <div className="sm-find-actions">
        <button type="button" className="sm-primary" onClick={onApply}>
          Apply import
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
