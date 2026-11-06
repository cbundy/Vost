import { useEffect, useRef, useState } from 'react';
import type { PineInput, PineInputValue, PinePlot } from '../lib/pine/types';
import { MAX_FILTER_ROLES, type PineRole, type PineRoleKind } from '../lib/backtest/pineRole';
import { convertToV6 } from '../lib/pine/convert';
import { workerCall } from '../state/worker';
import type { Candle } from '../types';
import { defaultRule, RuleFields } from '../lib/pineRuleEditor';
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

/** Reads a stored indicator's source, then runs it on a short slice of the chart for its plots and inputs. */
async function probeIndicator(id: string, inputs: Record<string, PineInputValue>, candles: Candle[]): Promise<Probe> {
  const fail = (message: string): Probe => ({ state: 'error', plots: [], inputs: [], message });
  try {
    const res = await fetch(`/api/pine/indicators/${encodeURIComponent(id)}`);
    if (res.status === 404) return fail('This indicator is no longer stored. Pick another one.');
    if (!res.ok) return fail(`The server answered HTTP ${res.status}`);
    const stored = ((await res.json()) as { source: string }).source;
    const source = convertToV6(stored).code;
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

/** Build a role for an indicator (reads its plots first); the error is shown to the user. */
export async function makeRole(role: PineRoleKind, indicator: Stored, candles: Candle[]): Promise<PineRole | string> {
  const probe = await probeIndicator(indicator.scriptId, {}, candles);
  if (probe.state === 'error') return probe.message;
  const first = defaultRule(role, probe.plots);
  if ('error' in first) return first.error;
  return {
    indicatorId: indicator.scriptId,
    name: indicator.name,
    inputs: {},
    role,
    ...(role === 'stop' && { mode: 'at-entry' as const }),
    ...(role === 'filter' && { label: 'trend' as const }),
    rule: first.rule,
  };
}

/** The Composed settings' TradingView indicator roles: the entry rule's indicator, the indicator filters, stop and target. */
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
  const stop = roles.find((r) => r.role === 'stop');
  const target = roles.find((r) => r.role === 'target');
  const replace = (old: PineRole, next: PineRole) => onChange(roles.map((r) => (r === old ? next : r)));
  const remove = (old: PineRole) => onChange(roles.filter((r) => r !== old));
  const create = async (kind: PineRoleKind, scriptId: string, old?: PineRole) => {
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
      {stop && (
        <div className="bt-role" aria-label="Indicator stop">
          <div className="section-title">Indicator stop</div>
          <RoleEditor role={stop} stored={stored ?? []} candles={candles} onChange={(r) => replace(stop, r)} onPick={(id) => void create('stop', id, stop)} onRemove={() => remove(stop)} />
        </div>
      )}
      {target && (
        <div className="bt-role" aria-label="Indicator target">
          <div className="section-title">Indicator target</div>
          <RoleEditor role={target} stored={stored ?? []} candles={candles} onChange={(r) => replace(target, r)} onPick={(id) => void create('target', id, target)} onRemove={() => remove(target)} />
        </div>
      )}
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
      <button
        className="btn"
        type="button"
        title={empty ? 'Add an indicator from the Pine pane (TradingView indicators) first' : undefined}
        disabled={empty || stored === null || stop != null}
        onClick={() => stored?.[0] && void create('stop', stored[0].scriptId)}
      >
        Add TradingView indicator stop
      </button>
      <button
        className="btn"
        type="button"
        title={empty ? 'Add an indicator from the Pine pane (TradingView indicators) first' : undefined}
        disabled={empty || stored === null || target != null}
        onClick={() => stored?.[0] && void create('target', stored[0].scriptId)}
      >
        Add TradingView indicator target
      </button>
    </div>
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
  const known = stored.some((s) => s.scriptId === role.indicatorId);
  const plots = probe.plots;

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
      <RuleFields role={role} plots={plots} onChange={onChange} />
      {probe.state === 'error' && (
        <p className="hint bt-role-error wide-row" role="alert">
          {probe.message}
        </p>
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
