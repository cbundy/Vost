/** The "TradingView indicators" fieldset of the market search: stored indicators as Composed entry rules or filters, with ranges on their number inputs. */
import { useEffect, useRef, useState } from 'react';
import { MAX_FILTER_ROLES, type PineRole } from '../lib/backtest/pineRole';
import { convertToV6 } from '../lib/pine/convert';
import { runPine } from '../lib/pine/runtime';
import type { PineInput, PineInputValue, PinePlot } from '../lib/pine/types';
import { defaultRule, RuleFields } from '../lib/pineRuleEditor';
import { demoProvider } from '../lib/providers/demo';
import type { Candle } from '../types';
import { fetchIndicatorSource, fetchStoredIndicators, type StoredIndicator } from './pineSources';
import { inputSettingCount, MAX_PINE_ENTRIES, pineEntries, pineFilters, rangeCount } from './sweep/pineSpace';
import type { SweepPineRange, SweepPineRole } from './sweep/types';

interface Probe {
  state: 'loading' | 'ok' | 'error';
  plots: PinePlot[];
  inputs: PineInput[];
  message: string;
}

const LOADING: Probe = { state: 'loading', plots: [], inputs: [], message: '' };
let demo: Promise<Candle[]> | null = null;
/** A short series to read an indicator's plots and inputs on: the page has no chart. */
const demoCandles = (): Promise<Candle[]> => (demo ??= demoProvider.fetchHistory({ symbol: 'DEMO', timeframe: '1d', bars: 120 }));

/** Reads a stored indicator's source, then runs it on the demo series for its plots and inputs. */
async function probeIndicator(id: string, inputs: Record<string, PineInputValue>): Promise<Probe> {
  const fail = (message: string): Probe => ({ state: 'error', plots: [], inputs: [], message });
  try {
    const stored = await fetchIndicatorSource(id);
    if (stored === null) return fail('This indicator is no longer stored. Remove it or pick another one.');
    const outcome = await runPine(convertToV6(stored).code, await demoCandles(), inputs);
    if (!outcome.ok) return fail(outcome.error.message);
    if (outcome.kind !== 'indicator') return fail('This script is a strategy, not an indicator.');
    return { state: 'ok', plots: outcome.plots, inputs: outcome.inputs, message: '' };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function useProbe(id: string, inputs: Record<string, PineInputValue>): Probe {
  const [probe, setProbe] = useState<Probe>(LOADING);
  const key = JSON.stringify([id, inputs]);
  const latest = useRef(inputs);
  latest.current = inputs;
  useEffect(() => {
    let live = true;
    void probeIndicator(id, latest.current).then((p) => live && setProbe(p));
    return () => {
      live = false;
    };
  }, [key, id]);
  return probe;
}

const isNumberInput = (i: PineInput): boolean => i.type === 'int' || i.type === 'float';
const numberOr = (v: PineInputValue | null | undefined, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** A first range around a number input's value: three values, inside its bounds. */
function firstRange(i: PineInput, value: number): SweepPineRange {
  const int = i.type === 'int';
  const step = int ? Math.max(1, Math.round(Math.abs(value) / 2)) : Math.max(0.1, Math.round(Math.abs(value) * 50) / 100);
  let from = value;
  let to = value + 2 * step;
  if (i.maxval !== undefined && to > i.maxval) {
    to = i.maxval;
    from = Math.max(i.minval ?? -Infinity, to - 2 * step);
  }
  return { input: i.name, from, to, step, ...(i.minval !== undefined && { min: i.minval }), ...(i.maxval !== undefined && { max: i.maxval }), ...(int && { int: true }) };
}

function NumberCell({ label, value, onChange, disabled }: { label: string; value: number; onChange: (v: number) => void; disabled: boolean }) {
  return (
    <label className="sm-pine-num">
      <span>{label}</span>
      <input type="number" step="any" value={Number.isFinite(value) ? value : ''} disabled={disabled} onChange={(e) => e.target.value !== '' && onChange(Number(e.target.value))} />
    </label>
  );
}

function InputRow({ input, p, onChange, disabled, fixedOnly }: { input: PineInput; p: SweepPineRole; onChange: (p: SweepPineRole) => void; disabled: boolean; fixedOnly?: boolean }) {
  const range = p.ranges.find((r) => r.input === input.name);
  const value = p.role.inputs[input.name] ?? input.defval;
  const setValue = (v: PineInputValue) => {
    const inputs = { ...p.role.inputs };
    if (v === input.defval) delete inputs[input.name];
    else inputs[input.name] = v;
    onChange({ ...p, role: { ...p.role, inputs } });
  };
  const setRange = (next: SweepPineRange | null) => {
    const inputs = { ...p.role.inputs };
    if (next) delete inputs[input.name];
    onChange({ ...p, role: { ...p.role, inputs }, ranges: next ? [...p.ranges.filter((r) => r.input !== input.name), next] : p.ranges.filter((r) => r.input !== input.name) });
  };
  if (isNumberInput(input)) {
    return (
      <div className="sm-pine-input" role="group" aria-label={`Input ${input.name}`}>
        <span className="sm-pine-input-name">{input.name}</span>
        {range ? (
          <>
            <NumberCell label="From" value={range.from} disabled={disabled} onChange={(from) => setRange({ ...range, from })} />
            <NumberCell label="To" value={range.to} disabled={disabled} onChange={(to) => setRange({ ...range, to })} />
            <NumberCell label="Step" value={range.step} disabled={disabled} onChange={(step) => setRange({ ...range, step })} />
            <span className="sm-bars">{range.step > 0 && range.to >= range.from ? `${rangeCount(range)} values` : ''}</span>
            <button type="button" className="ghost" disabled={disabled} onClick={() => setRange(null)}>
              Fix the value
            </button>
          </>
        ) : (
          <>
            <NumberCell label="Value" value={numberOr(value, 0)} disabled={disabled} onChange={setValue} />
            {!fixedOnly && (
              <button type="button" className="ghost" disabled={disabled} onClick={() => setRange(firstRange(input, numberOr(value, 0)))}>
                Search a range
              </button>
            )}
          </>
        )}
      </div>
    );
  }
  if (input.type === 'bool') {
    return (
      <label className="sm-check">
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => setValue(e.target.checked)} />
        {input.name}
      </label>
    );
  }
  if (input.options && input.options.length > 0) {
    return (
      <label className="sm-pine-num">
        <span>{input.name}</span>
        <select value={String(value)} disabled={disabled} onChange={(e) => setValue(input.options!.find((o) => String(o) === e.target.value) ?? e.target.value)}>
          {input.options.map((o) => (
            <option key={String(o)} value={String(o)}>
              {String(o)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  return null;
}

function RoleCard({ p, onChange, onRemove, disabled }: { p: SweepPineRole; onChange: (p: SweepPineRole) => void; onRemove: () => void; disabled: boolean }) {
  const probe = useProbe(p.role.indicatorId, p.role.inputs);
  const settings = p.ranges.length > 0 ? inputSettingCount(p) : 1;
  return (
    <div className="sm-pine-role" role="group" aria-label={`${p.role.role === 'entry' ? 'Entry rule' : 'Filter'}: ${p.role.name}`}>
      <div className="sm-pine-head">
        <strong>{p.role.name}</strong>
        <span className="sm-badge">{p.role.role === 'entry' ? 'entry rule' : 'filter, off and on'}</span>
        <span className="sm-bars">
          {Number.isFinite(settings) ? settings.toLocaleString('en-US') : 'too many'} input setting{settings === 1 ? '' : 's'}
        </span>
        <button type="button" className="ghost" disabled={disabled} onClick={onRemove}>
          Remove
        </button>
      </div>
      {probe.state === 'loading' && <span className="sm-note">Reading the indicator...</span>}
      {probe.state === 'error' && (
        <p className="sm-field-error" role="alert">
          {probe.message}
        </p>
      )}
      <div className="sm-pine-grid">
        <RuleFields role={p.role} plots={probe.plots} onChange={(role) => onChange({ ...p, role })} />
      </div>
      {probe.inputs.length > 0 && (
        <div className="sm-pine-inputs">
          {probe.inputs.map((i) => (
            <InputRow key={i.name} input={i} p={p} onChange={onChange} disabled={disabled} />
          ))}
        </div>
      )}
    </div>
  );
}

export function SweepPineRoles({ pine, onChange, disabled }: { pine: SweepPineRole[]; onChange: (pine: SweepPineRole[]) => void; disabled: boolean }) {
  const [stored, setStored] = useState<StoredIndicator[] | null>(null);
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const ctl = new AbortController();
    fetchStoredIndicators(ctl.signal).then(
      (list) => setStored(list),
      () => !ctl.signal.aborted && setStored([]),
    );
    return () => ctl.abort();
  }, []);

  const entries = pineEntries({ entryRules: [], filters: [], trendTfs: [], pine }).length;
  const filters = pineFilters({ entryRules: [], filters: [], trendTfs: [], pine }).length;
  const chosen = stored?.find((s) => s.scriptId === (pick || stored[0]?.scriptId));
  const add = async (kind: 'entry' | 'filter') => {
    if (!chosen) return;
    setError('');
    const probe = await probeIndicator(chosen.scriptId, {});
    if (probe.state === 'error') return setError(`${chosen.name}: ${probe.message}`);
    const first = defaultRule(kind, probe.plots);
    if ('error' in first) return setError(`${chosen.name}: ${first.error}`);
    onChange([...pine, { role: { indicatorId: chosen.scriptId, name: chosen.name, inputs: {}, role: kind, ...(kind === 'filter' && { label: 'trend' as const }), rule: first.rule }, ranges: [] }]);
  };
  const empty = stored !== null && stored.length === 0;

  return (
    <fieldset disabled={disabled} className="sm-pine">
      <legend>TradingView indicators</legend>
      <span className="sm-note">
        Try a stored TradingView indicator as an extra Composed entry rule, or as a filter tried off and on. Pick number inputs to step over a range: the script
        runs once for each input setting on each market.
      </span>
      {empty && <span className="sm-note">No TradingView indicators are stored. Add one from the Pine pane in Vost (TradingView indicators).</span>}
      {pine.map((p, k) => (
        <RoleCard key={k} p={p} disabled={disabled} onChange={(next) => onChange(pine.map((x, j) => (j === k ? next : x)))} onRemove={() => onChange(pine.filter((_, j) => j !== k))} />
      ))}
      {error && (
        <p className="sm-field-error" role="alert">
          {error}
        </p>
      )}
      {stored !== null && stored.length > 0 && (
        <div className="sm-pine-add">
          <select aria-label="TradingView indicator to add" value={chosen?.scriptId ?? ''} onChange={(e) => setPick(e.target.value)}>
            {stored.map((s) => (
              <option key={s.scriptId} value={s.scriptId}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" disabled={entries >= MAX_PINE_ENTRIES} onClick={() => void add('entry')}>
            Add as entry rule
          </button>
          <button type="button" disabled={filters >= MAX_FILTER_ROLES} onClick={() => void add('filter')}>
            Add as filter
          </button>
        </div>
      )}
    </fieldset>
  );
}

/**
 * The picker of the TradingView indicator stop: one stored indicator, its line plot, at entry or trailing, and its fixed
 * inputs. The search tries the plot as the stop of every Composed setting with each take profit multiple.
 */
export function SweepPineStop({ stop, onChange, disabled }: { stop: Omit<PineRole, 'source'> | null; onChange: (stop: Omit<PineRole, 'source'> | null) => void; disabled: boolean }) {
  const [stored, setStored] = useState<StoredIndicator[] | null>(null);
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const ctl = new AbortController();
    fetchStoredIndicators(ctl.signal).then(
      (list) => setStored(list),
      () => !ctl.signal.aborted && setStored([]),
    );
    return () => ctl.abort();
  }, []);
  const probe = useProbe(stop?.indicatorId ?? '', stop?.inputs ?? {});
  const chosen = stored?.find((s) => s.scriptId === (pick || stored[0]?.scriptId));
  const choose = async () => {
    if (!chosen) return;
    setError('');
    const first = await probeIndicator(chosen.scriptId, {});
    if (first.state === 'error') return setError(`${chosen.name}: ${first.message}`);
    const rule = defaultRule('stop', first.plots);
    if ('error' in rule) return setError(`${chosen.name}: ${rule.error}`);
    onChange({ indicatorId: chosen.scriptId, name: chosen.name, inputs: {}, role: 'stop', mode: 'at-entry', rule: rule.rule });
  };
  const asRole: SweepPineRole | null = stop ? { role: stop, ranges: [] } : null;
  return (
    <div className="sm-pine" role="group" aria-label="TradingView indicator stop">
      <span className="sm-note">
        The stop sits at one plot of a stored indicator, fixed at the entry bar or trailing it. It is tried on Composed settings only, with each take profit
        multiple below as a multiple of the stop distance.
      </span>
      {stored !== null && stored.length === 0 && <span className="sm-note">No TradingView indicators are stored. Add one from the Pine pane in Vost (TradingView indicators).</span>}
      {stop && asRole && (
        <div className="sm-pine-role">
          <div className="sm-pine-head">
            <strong>{stop.name}</strong>
            <span className="sm-badge">stop</span>
            <button type="button" className="ghost" disabled={disabled} onClick={() => onChange(null)}>
              Remove
            </button>
          </div>
          {probe.state === 'loading' && <span className="sm-note">Reading the indicator...</span>}
          {probe.state === 'error' && (
            <p className="sm-field-error" role="alert">
              {probe.message}
            </p>
          )}
          <div className="sm-pine-grid">
            <RuleFields role={stop} plots={probe.plots} onChange={(role) => onChange(role)} />
          </div>
          {probe.inputs.length > 0 && (
            <div className="sm-pine-inputs">
              {probe.inputs.map((i) => (
                <InputRow key={i.name} input={i} p={asRole} fixedOnly onChange={(next) => onChange(next.role)} disabled={disabled} />
              ))}
            </div>
          )}
        </div>
      )}
      {error && (
        <p className="sm-field-error" role="alert">
          {error}
        </p>
      )}
      {!stop && stored !== null && stored.length > 0 && (
        <div className="sm-pine-add">
          <select aria-label="TradingView indicator for the stop" value={chosen?.scriptId ?? ''} onChange={(e) => setPick(e.target.value)}>
            {stored.map((s) => (
              <option key={s.scriptId} value={s.scriptId}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" onClick={() => void choose()}>
            Use as the stop
          </button>
        </div>
      )}
    </div>
  );
}
