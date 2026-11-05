import { SIGNAL_FAMILIES } from './engine';
import { getStrategy } from '../lib/backtest/strategies';
import { blocker, type FormErrors } from './form';
import type { FindStage } from './run';
import type { FindForm } from './store';

export interface SetChoice {
  id: string;
  label: string;
  count: number;
}

export interface RunState {
  running: boolean;
  pct: number;
  stage: FindStage;
  onPage: boolean;
}

interface Props {
  form: FindForm;
  onChange: (f: FindForm) => void;
  sets: SetChoice[];
  /** The sets Find will train on. */
  chosen: string[];
  onChosen: (ids: string[]) => void;
  errors: FormErrors;
  trades: number;
  run: RunState;
  onFind: () => void;
  onCancel: () => void;
}

const toggle = (list: string[], v: string): string[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export const familyName = (id: string | null): string => (id ? getStrategy(id).name : 'Other readings');

export function TargetsForm({ form, onChange, sets, chosen, onChosen, errors, trades, run, onFind, onCancel }: Props) {
  const set = <K extends keyof FindForm>(k: K, v: FindForm[K]) => onChange({ ...form, [k]: v });
  const reason = blocker(errors, form.families, trades);
  const field = (k: keyof FormErrors, label: string, unit: string, hint?: string) => (
    <label className="sm-field">
      <span>{label}</span>
      <span className="sm-field-row">
        <input
          inputMode="decimal"
          value={form[k]}
          placeholder={hint}
          onChange={(e) => set(k, e.target.value)}
          aria-invalid={errors[k] ? true : undefined}
          aria-describedby={errors[k] ? `sm-err-${k}` : undefined}
          disabled={run.running}
        />
        <span className="sm-unit">{unit}</span>
      </span>
      {errors[k] && (
        <span className="sm-field-error" id={`sm-err-${k}`} role="alert">
          {errors[k]}
        </span>
      )}
    </label>
  );
  return (
    <section className="sm-find" aria-label="Find a strategy">
      <h2>Find a strategy</h2>
      <div className="sm-form">
        <fieldset disabled={run.running}>
          <legend>Strategy type</legend>
          {(['both', 'long', 'short'] as const).map((d) => (
            <label key={d} className="sm-check">
              <input type="radio" name="sm-direction" checked={form.direction === d} onChange={() => set('direction', d)} />
              {d === 'both' ? 'Long and short' : d === 'long' ? 'Long only' : 'Short only'}
            </label>
          ))}
        </fieldset>
        <fieldset disabled={run.running}>
          <legend>Allowed indicators</legend>
          {SIGNAL_FAMILIES.map((f) => (
            <label key={f} className="sm-check">
              <input type="checkbox" checked={form.families.includes(f)} onChange={() => set('families', toggle(form.families, f))} />
              {familyName(f)}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Risk (always on)</legend>
          {field('feeBps', 'Fee', 'bps')}
          {field('slippageBps', 'Slippage', 'bps')}
          {field('stopLossPct', 'Stop loss', '%', 'none')}
          {field('takeProfitPct', 'Take profit', '%', 'none')}
        </fieldset>
        <fieldset>
          <legend>Targets (empty = not applied)</legend>
          {field('minRR', 'Min R:R', '', 'any')}
          {field('minHitRatePct', 'Min hit rate', '%', 'any')}
          {field('maxDrawdownPct', 'Max drawdown', '%', 'any')}
        </fieldset>
        <fieldset disabled={run.running}>
          <legend>Train on</legend>
          {sets.length === 0 && <span className="sm-note">No marked trades yet.</span>}
          {sets.map((s) => (
            <label key={s.id} className="sm-check">
              <input type="checkbox" checked={chosen.includes(s.id)} onChange={() => onChosen(toggle(chosen, s.id))} />
              <span>
                {s.label} <span className="sm-bars">({s.count} trade{s.count === 1 ? '' : 's'})</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
      <div className="sm-find-actions">
        {run.running ? (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button type="button" className="sm-primary" onClick={onFind} disabled={reason !== null}>
            Find a strategy
          </button>
        )}
        {!run.running && reason && <span className="sm-note" aria-live="polite">{reason}</span>}
      </div>
      {run.running && (
        <div className="sm-progress" role="status" aria-live="polite">
          <progress max={100} value={Math.round(run.pct * 100)} aria-label="Progress" />
          <span>
            {run.stage} - {Math.round(run.pct * 100)}%
          </span>
          {run.onPage && <span className="sm-note sm-warn">Running on this page; it may pause while it works.</span>}
        </div>
      )}
    </section>
  );
}
