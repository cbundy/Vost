import { useEffect, useMemo, useRef, useState } from 'react';
import type { PineInput, PineInputValue, PinePlot } from '../lib/pine/types';
import {
  MAX_FILTER_ROLES,
  type PineOperand,
  type PineRole,
  type PineRoleLabel,
  type PineRule,
} from '../lib/backtest/pineRole';
import { workerCall } from '../state/worker';
import type { Candle } from '../types';
import { PineInputList } from './PineInputControl';

interface Stored {
  scriptId: string;
  name: string;
}

interface Probe {
  state: 'loading' | 'ok' | 'error';
  plots: PinePlot[];
  inputs: PineInput[];
  message: string;
}

const isShapeKind = (p: PinePlot) => p.kind === 'plotshape' || p.kind === 'plotarrow';
const isLine = (p: PinePlot) => p.kind === 'plot' || p.kind === 'hline';
const LABELS: Array<{ value: PineRoleLabel; text: string }> = [
  { value: 'trend', text: 'Trend' },
  { value: 'volume', text: 'Volume' },
  { value: 'volatility', text: 'Volatility' },
  { value: 'strength', text: 'Trend strength' },
  { value: 'custom', text: 'Custom' },
];

/** Reads a stored indicator's source, then runs it on a short slice of the chart for its plots and inputs. */
async function probeIndicator(id: string, inputs: Record<string, PineInputValue>, candles: Candle[]): Promise<Probe> {
  const fail = (message: string): Probe => ({ state: 'error', plots: [], inputs: [], message });
  try {
    const res = await fetch(`/api/pine/indicators/${encodeURIComponent(id)}`);
    if (res.status === 404) return fail('This indicator is no longer stored. Pick another one.');
    if (!res.ok) return fail(`The server answered HTTP ${res.status}`);
    const { source } = (await res.json()) as { source: string };
    if (candles.length === 0) return fail('Load some data to read the indicator.');
    const msg = await workerCall({ type: 'pine', source, candles: candles.slice(0, 60), inputs });
    if (msg.type !== 'pineResult') return fail('Unexpected worker reply');
    if (!msg.outcome.ok) return fail(msg.outcome.error.message);
    if (msg.outcome.kind !== 'indicator') return fail('This script is a strategy, not an indicator.');
    return { state: 'ok', plots: msg.outcome.plots, inputs: msg.outcome.inputs, message: '' };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

function useProbe(id: string, inputs: Record<string, PineInputValue>, candles: Candle[]): Probe {
  const [probe, setProbe] = useState<Probe>({ state: 'loading', plots: [], inputs: [], message: '' });
  const key = JSON.stringify([id, inputs]);
  const hasData = candles.length > 0;
  const bars = useRef(candles);
  bars.current = candles;
  useEffect(() => {
    let live = true;
    setProbe((p) => ({ ...p, state: p.state === 'ok' ? 'ok' : 'loading' }));
    void probeIndicator(id, inputs, bars.current).then((p) => live && setProbe(p));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, hasData]);
  return probe;
}

/** A first rule for a new role from the indicator's plots, or a plain reason there is none. */
export function defaultRule(role: 'entry' | 'filter', plots: PinePlot[]): { rule: PineRule } | { error: string } {
  const line = plots.find(isLine);
  if (role === 'entry') {
    if (line) return { rule: { type: 'cross', a: { kind: 'close' }, b: { kind: 'plot', plot: line.name } } };
    const shapes = plots.filter(isShapeKind);
    if (shapes.length > 0) return { rule: { type: 'shape', long: shapes[0].name, ...(shapes[1] && { short: shapes[1].name }) } };
    return { error: 'This indicator draws no plot that can give entries.' };
  }
  if (line) return { rule: { type: 'above', a: { kind: 'close' }, b: { kind: 'plot', plot: line.name } } };
  return { error: 'This indicator has no line plot to compare with.' };
}

/** Build a role for an indicator (reads its plots first); the error is shown to the user. */
export async function makeRole(role: 'entry' | 'filter', indicator: Stored, candles: Candle[]): Promise<PineRole | string> {
  const probe = await probeIndicator(indicator.scriptId, {}, candles);
  if (probe.state === 'error') return probe.message;
  const first = defaultRule(role, probe.plots);
  if ('error' in first) return first.error;
  return { indicatorId: indicator.scriptId, name: indicator.name, inputs: {}, role, ...(role === 'filter' && { label: 'trend' as const }), rule: first.rule };
}

/** The Composed settings' TradingView indicator roles: the entry rule's indicator and the indicator filters. */
export function PineRolePicker({
  roles,
  entryIsPine,
  candles,
  onChange,
}: {
  roles: PineRole[];
  entryIsPine: boolean;
  candles: Candle[];
  onChange: (roles: PineRole[]) => void;
}) {
  const [stored, setStored] = useState<Stored[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    fetch('/api/pine/indicators')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((b: { indicators: Stored[] }) => live && setStored(b.indicators))
      .catch(() => live && setStored([]));
    return () => {
      live = false;
    };
  }, []);

  const entry = roles.find((r) => r.role === 'entry');
  const filters = roles.filter((r) => r.role === 'filter');
  const replace = (old: PineRole, next: PineRole) => onChange(roles.map((r) => (r === old ? next : r)));
  const remove = (old: PineRole) => onChange(roles.filter((r) => r !== old));
  const create = async (kind: 'entry' | 'filter', scriptId: string, old?: PineRole) => {
    const indicator = stored?.find((s) => s.scriptId === scriptId);
    if (!indicator) return;
    setError('');
    const made = await makeRole(kind, indicator, candles);
    if (typeof made === 'string') return setError(`${indicator.name}: ${made}`);
    if (old) replace(old, made);
    else onChange([...roles, made]);
  };
  const empty = stored !== null && stored.length === 0;
  const emptyHint = <p className="hint">No TradingView indicators are stored. Add one from the Pine pane (TradingView indicators).</p>;

  return (
    <div className="bt-roles">
      {entryIsPine && (
        <div className="bt-role" aria-label="Entry indicator">
          <div className="section-title">Entry indicator</div>
          {empty && emptyHint}
          {entry ? (
            <RoleEditor role={entry} stored={stored ?? []} candles={candles} onChange={(r) => replace(entry, r)} onPick={(id) => void create('entry', id, entry)} />
          ) : (
            !empty && (
              <label className="form-field">
                <span>Indicator</span>
                <select value="" aria-label="Entry indicator" onChange={(e) => e.target.value && void create('entry', e.target.value)}>
                  <option value="">Pick a TradingView indicator...</option>
                  {(stored ?? []).map((s) => (
                    <option key={s.scriptId} value={s.scriptId}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )
          )}
        </div>
      )}
      {filters.map((f, k) => (
        <div className="bt-role" key={k} aria-label={`Indicator filter ${k + 1}`}>
          <div className="section-title">Indicator filter {k + 1}</div>
          <RoleEditor role={f} stored={stored ?? []} candles={candles} onChange={(r) => replace(f, r)} onPick={(id) => void create('filter', id, f)} onRemove={() => remove(f)} />
        </div>
      ))}
      {error && (
        <p className="hint bt-role-error" role="alert">
          {error}
        </p>
      )}
      <button
        className="btn"
        type="button"
        title={empty ? 'Add an indicator from the Pine pane (TradingView indicators) first' : undefined}
        disabled={empty || stored === null || filters.length >= MAX_FILTER_ROLES}
        onClick={() => stored?.[0] && void create('filter', stored[0].scriptId)}
      >
        Add TradingView indicator filter
      </button>
    </div>
  );
}

const operandValue = (o: PineOperand) => (o.kind === 'plot' ? `plot:${o.plot}` : o.kind);

function OperandSelect({ label, operand, plots, onChange }: { label: string; operand: PineOperand; plots: PinePlot[]; onChange: (o: PineOperand) => void }) {
  const titles = plots.filter(isLine).map((p) => p.name);
  if (operand.kind === 'plot' && !titles.includes(operand.plot)) titles.push(operand.plot);
  return (
    <div className="form-field">
      <span>{label}</span>
      <div className="exit-row">
        <select
          aria-label={label}
          value={operandValue(operand)}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === 'close' ? { kind: 'close' } : v === 'level' ? { kind: 'level', value: operand.kind === 'level' ? operand.value : 0 } : { kind: 'plot', plot: v.slice(5) });
          }}
        >
          <option value="close">Close</option>
          <option value="level">Level</option>
          {titles.map((t) => (
            <option key={t} value={`plot:${t}`}>
              {t}
            </option>
          ))}
        </select>
        {operand.kind === 'level' && (
          <input
            type="number"
            aria-label={`${label} level`}
            value={operand.value}
            step="any"
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange({ kind: 'level', value: v });
            }}
          />
        )}
      </div>
    </div>
  );
}

function ShapeSelect({ label, value, plots, onChange }: { label: string; value: string | undefined; plots: PinePlot[]; onChange: (v: string | undefined) => void }) {
  const titles = plots.filter(isShapeKind).map((p) => p.name);
  if (value && !titles.includes(value)) titles.push(value);
  return (
    <label className="form-field">
      <span>{label}</span>
      <select aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">None</option>
        {titles.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}

function RoleEditor({
  role,
  stored,
  candles,
  onChange,
  onPick,
  onRemove,
}: {
  role: PineRole;
  stored: Stored[];
  candles: Candle[];
  onChange: (r: PineRole) => void;
  onPick: (scriptId: string) => void;
  onRemove?: () => void;
}) {
  const probe = useProbe(role.indicatorId, role.inputs, candles);
  const rule = role.rule;
  const set = (next: PineRule) => onChange({ ...role, rule: next });
  const known = stored.some((s) => s.scriptId === role.indicatorId);
  const plots = probe.plots;
  const entryTypes = useMemo(
    () => [
      { value: 'cross', text: 'Crosses' },
      { value: 'shape', text: 'Shape drawn' },
    ],
    [],
  );
  const retype = (type: string) => {
    const line = plots.find(isLine)?.name ?? '';
    const a: PineOperand = rule.type === 'cross' || rule.type === 'above' || rule.type === 'below' || rule.type === 'inside' ? rule.a : { kind: 'close' };
    const b: PineOperand = 'b' in rule ? rule.b : { kind: 'plot', plot: line };
    if (type === 'cross') set({ type, a, b });
    else if (type === 'shape') {
      const shapes = plots.filter(isShapeKind);
      if (shapes.length > 0) set({ type, long: shapes[0].name, ...(shapes[1] && { short: shapes[1].name }) });
    } else if (type === 'above' || type === 'below') set({ type, a, b });
    else if (type === 'inside') set({ type, a, lo: { kind: 'level', value: 0 }, hi: { kind: 'level', value: 100 } });
  };

  return (
    <div className="form-grid bt-role-grid">
      <label className="form-field">
        <span>Indicator</span>
        <select aria-label="Indicator" value={role.indicatorId} onChange={(e) => onPick(e.target.value)}>
          {!known && <option value={role.indicatorId}>{role.name} (not stored)</option>}
          {stored.map((s) => (
            <option key={s.scriptId} value={s.scriptId}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      {role.role === 'filter' && (
        <label className="form-field">
          <span>Filter label</span>
          <select aria-label="Filter label" value={role.label ?? 'custom'} onChange={(e) => onChange({ ...role, label: e.target.value as PineRoleLabel })}>
            {LABELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.text}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="form-field">
        <span>Rule</span>
        <select aria-label="Rule" value={rule.type} onChange={(e) => retype(e.target.value)}>
          {role.role === 'entry' ? (
            entryTypes.map((t) => (
              <option key={t.value} value={t.value}>
                {t.text}
              </option>
            ))
          ) : (
            <>
              <option value="above">Above (short: below)</option>
              <option value="below">Below (short: above)</option>
              <option value="inside">Inside a range</option>
            </>
          )}
        </select>
      </label>
      {probe.state === 'error' && (
        <p className="hint bt-role-error wide-row" role="alert">
          {probe.message}
        </p>
      )}
      {(rule.type === 'cross' || rule.type === 'above' || rule.type === 'below') && (
        <>
          <OperandSelect label={rule.type === 'cross' ? 'Crossing' : 'Value'} operand={rule.a} plots={plots} onChange={(a) => set({ ...rule, a })} />
          <OperandSelect label={rule.type === 'cross' ? 'Against' : rule.type === 'above' ? 'Above' : 'Below'} operand={rule.b} plots={plots} onChange={(b) => set({ ...rule, b })} />
        </>
      )}
      {rule.type === 'inside' && (
        <>
          <OperandSelect label="Value" operand={rule.a} plots={plots} onChange={(a) => set({ ...rule, a })} />
          <OperandSelect label="From" operand={rule.lo} plots={plots} onChange={(lo) => set({ ...rule, lo })} />
          <OperandSelect label="To" operand={rule.hi} plots={plots} onChange={(hi) => set({ ...rule, hi })} />
        </>
      )}
      {rule.type === 'shape' && (
        <>
          <ShapeSelect label="Long shape" value={rule.long} plots={plots} onChange={(long) => (long || rule.short) && set({ type: 'shape', ...(long && { long }), ...(rule.short && { short: rule.short }) })} />
          <ShapeSelect label="Short shape" value={rule.short} plots={plots} onChange={(short) => (short || rule.long) && set({ type: 'shape', ...(rule.long && { long: rule.long }), ...(short && { short }) })} />
          {(!rule.long || !rule.short) && (
            <p className="hint wide-row">With only one side mapped, the position leaves only by a stop loss, take profit, trailing stop or the end of data.</p>
          )}
        </>
      )}
      {probe.inputs.length > 0 && (
        <div className="wide-row">
          <PineInputList
            className="bt-pine-inputs"
            inputs={probe.inputs}
            valueOf={(i) => role.inputs[i.name] ?? i.defval}
            onChange={(i, v) => onChange({ ...role, inputs: { ...role.inputs, [i.name]: v } })}
          />
        </div>
      )}
      {onRemove && (
        <button className="btn" type="button" onClick={onRemove}>
          Remove
        </button>
      )}
    </div>
  );
}
