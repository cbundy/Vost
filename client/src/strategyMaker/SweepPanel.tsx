import { useEffect, useMemo, useState } from 'react';
import type { MarketList } from '../../../shared/marketLists.ts';
import type { EngineClient } from './engineClient';
import { fetchMarketLists } from './marketLists';
import { MAX_SWEEP_COMBOS } from './sweep/sweep';
import { SweepResults } from './SweepResults';
import {
  defaultSweepForm,
  EXIT_KIND_OPTIONS,
  planSweep,
  STOP_MULT_OPTIONS,
  SWEEP_FAMILIES,
  SWEEP_TIMEFRAMES,
  TP_MULT_OPTIONS,
  type SweepForm,
} from './sweepForm';
import type { JobKeeper, ReattachPlan } from './reattach';
import { placeNote } from './TargetsForm';
import { useSweep } from './useSweep';

const toggle = <T,>(list: T[], v: T): T[] => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
const NO_LISTS: MarketList[] = [];
const count = (n: number): string => n.toLocaleString('en-US');

interface Props {
  /** The page's engine client: a Find or a Search replaces the run before it. */
  getClient: () => EngineClient;
  /** Keeps the record of the server job a market search waits for. */
  keeper?: JobKeeper;
  /** The server could not take the search, so it runs in the browser. */
  onFallback?: (reason: string) => void;
  /** The search the page was waiting for when it was closed, to follow or show. */
  reattach?: ReattachPlan | null;
}

type Lists = { state: 'loading' } | { state: 'error'; error: string } | { state: 'ok'; lists: MarketList[] };

export function SweepPanel({ getClient, keeper, onFallback, reattach }: Props) {
  const [form, setForm] = useState<SweepForm>(defaultSweepForm);
  const [lists, setLists] = useState<Lists>({ state: 'loading' });
  const sweep = useSweep(getClient, { keeper, onFallback });
  const running = sweep.run.running;
  const adopt = sweep.adopt;

  useEffect(() => {
    if (reattach) void adopt(reattach);
  }, [reattach, adopt]);

  useEffect(() => {
    const ctl = new AbortController();
    fetchMarketLists(ctl.signal).then(
      (r) => setLists('error' in r ? { state: 'error', error: r.error } : { state: 'ok', lists: r.lists }),
      () => undefined,
    );
    return () => ctl.abort();
  }, []);

  const all = lists.state === 'ok' ? lists.lists : NO_LISTS;
  const plan = useMemo(() => planSweep(form, all), [form, all]);
  const set = <K extends keyof SweepForm>(k: K, v: SweepForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const err = (k: string) =>
    plan.errors[k] && (
      <span className="sm-field-error" id={`sm-sweep-err-${k}`} role="alert">
        {plan.errors[k]}
      </span>
    );
  const field = (k: 'capital' | 'riskPct' | 'feeBps' | 'slippageBps', label: string, unit: string) => (
    <label className="sm-field">
      <span>{label}</span>
      <span className="sm-field-row">
        <input
          inputMode="decimal"
          value={form[k]}
          onChange={(e) => set(k, e.target.value)}
          aria-invalid={plan.errors[k] ? true : undefined}
          aria-describedby={plan.errors[k] ? `sm-sweep-err-${k}` : undefined}
          disabled={running}
        />
        <span className="sm-unit">{unit}</span>
      </span>
      {err(k)}
    </label>
  );
  const targetCell = (i: number, k: 'hit' | 'rr', label: string, unit: string) => {
    const key = `${k}${i}`;
    return (
      <label className="sm-field">
        <span>{label}</span>
        <span className="sm-field-row">
          <input
            inputMode="decimal"
            value={form.targets[i][k]}
            onChange={(e) => set('targets', form.targets.map((t, j) => (j === i ? { ...t, [k]: e.target.value } : t)))}
            aria-invalid={plan.errors[key] ? true : undefined}
            aria-describedby={plan.errors[key] ? `sm-sweep-err-${key}` : undefined}
            disabled={running}
          />
          <span className="sm-unit">{unit}</span>
        </span>
        {err(key)}
      </label>
    );
  };

  return (
    <section className="sm-find sm-sweep" aria-label="Search markets">
      <h2>Search markets</h2>
      <p className="sm-note">
        Try many indicator settings and exits on many markets and timeframes, and keep the ones that reach your targets. The last 30% of every market is kept
        out of the search to check them on.
      </p>
      <div className="sm-form">
        <fieldset disabled={running}>
          <legend>Market lists</legend>
          {lists.state === 'loading' && <span className="sm-note">Loading the lists...</span>}
          {lists.state === 'error' && (
            <span className="sm-field-error" role="alert">
              The market lists could not be loaded: {lists.error}
            </span>
          )}
          {all.map((l) => (
            <label key={l.id} className="sm-check">
              <input type="checkbox" checked={form.listIds.includes(l.id)} disabled={!!l.error} onChange={() => set('listIds', toggle(form.listIds, l.id))} />
              <span>
                {l.title}{' '}
                <span className="sm-bars">
                  ({l.date}, {l.entries.length} markets)
                </span>
                {l.stale && <span className="sm-badge sm-badge-miss">stale</span>}
                {l.error && <span className="sm-field-error"> {l.error}</span>}
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset disabled={running}>
          <legend>Timeframes</legend>
          {SWEEP_TIMEFRAMES.map((tf) => (
            <label key={tf} className="sm-check">
              <input type="checkbox" checked={form.timeframes.includes(tf)} onChange={() => set('timeframes', toggle(form.timeframes, tf))} />
              {tf}
            </label>
          ))}
        </fieldset>
        <fieldset disabled={running}>
          <legend>Indicators</legend>
          {SWEEP_FAMILIES.map((f) => (
            <label key={f.id} className="sm-check">
              <input type="checkbox" checked={form.families.includes(f.id)} onChange={() => set('families', toggle(form.families, f.id))} />
              {f.name}
            </label>
          ))}
        </fieldset>
        <fieldset disabled={running}>
          <legend>Strategy type</legend>
          {(['long', 'both', 'short'] as const).map((d) => (
            <label key={d} className="sm-check">
              <input type="radio" name="sm-sweep-direction" checked={form.direction === d} onChange={() => set('direction', d)} />
              {d === 'both' ? 'Long and short' : d === 'long' ? 'Long only' : 'Short only'}
            </label>
          ))}
        </fieldset>
        <fieldset disabled={running} className="sm-targets">
          <legend>Targets (a result needs to meet either)</legend>
          {form.targets.map((_, i) => (
            <div key={i} className="sm-target-row">
              {i > 0 && <span className="sm-or">or</span>}
              {targetCell(i, 'hit', 'Min hit rate', '%')}
              {targetCell(i, 'rr', 'Min R:R', '')}
            </div>
          ))}
          <span className="sm-note">Clear both boxes of a row to leave it out.</span>
        </fieldset>
        <fieldset disabled={running}>
          <legend>Sizing and costs</legend>
          {field('capital', 'Account size', '')}
          {field('riskPct', 'Risk per trade', '%')}
          {field('feeBps', 'Fee', 'bps')}
          {field('slippageBps', 'Slippage', 'bps')}
        </fieldset>
        <fieldset disabled={running}>
          <legend>Exit kinds</legend>
          {EXIT_KIND_OPTIONS.map((o) => (
            <label key={o.id} className="sm-check">
              <input type="checkbox" checked={form.exitKinds.includes(o.id)} onChange={() => set('exitKinds', toggle(form.exitKinds, o.id))} />
              {o.label}
            </label>
          ))}
        </fieldset>
        <fieldset disabled={running}>
          <legend>Stop (times the typical bar range or the ATR)</legend>
          {STOP_MULT_OPTIONS.map((m) => (
            <label key={m} className="sm-check">
              <input type="checkbox" checked={form.stopMults.includes(m)} onChange={() => set('stopMults', toggle(form.stopMults, m).sort((a, b) => a - b))} />
              {m}x
            </label>
          ))}
        </fieldset>
        <fieldset disabled={running}>
          <legend>Take profit (times the stop)</legend>
          {TP_MULT_OPTIONS.map((m) => (
            <label key={m} className="sm-check">
              <input type="checkbox" checked={form.tpMults.includes(m)} onChange={() => set('tpMults', toggle(form.tpMults, m).sort((a, b) => a - b))} />
              {m}x
            </label>
          ))}
        </fieldset>
      </div>
      <p className="sm-sweep-count" role="status" aria-live="polite">
        {count(plan.input.markets.length)} market{plan.input.markets.length === 1 ? '' : 's'} x {count(form.timeframes.length)} timeframe
        {form.timeframes.length === 1 ? '' : 's'} = {count(plan.combos)} combinations
        {plan.combos > MAX_SWEEP_COMBOS ? ` (over the limit of ${count(MAX_SWEEP_COMBOS)})` : ''}
      </p>
      <div className="sm-find-actions">
        {running ? (
          <button type="button" onClick={sweep.cancel}>
            Cancel
          </button>
        ) : (
          <button type="button" className="sm-primary" onClick={() => void sweep.start(plan.input)} disabled={plan.blocker !== null}>
            Search markets
          </button>
        )}
        {!running && plan.blocker && (
          <span className="sm-note" aria-live="polite">
            {plan.blocker}
          </span>
        )}
      </div>
      {running && (
        <div className="sm-progress" role="status" aria-live="polite">
          <progress max={100} value={Math.round(sweep.run.pct * 100)} aria-label="Search progress" />
          <span>
            {Math.round(sweep.run.pct * 100)}%{sweep.run.label ? ` - ${sweep.run.label}` : ''}
          </span>
          {placeNote(sweep.run) && <span className="sm-note">{placeNote(sweep.run)}</span>}
        </div>
      )}
      {sweep.error && (
        <p className="sm-error" role="alert">
          {sweep.error}
        </p>
      )}
      {sweep.done && !running && <SweepResults result={sweep.done.result} risk={sweep.done.risk} />}
    </section>
  );
}
