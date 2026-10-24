import { useEffect, useState } from 'react';
import { CUSTOM_STRATEGY_EXAMPLES, DEFAULT_CUSTOM_CODE } from '../lib/backtest/custom';
import { PINE_STRATEGY_EXAMPLES, DEFAULT_PINE_CODE } from '../lib/pine/examples';
import type { PineInput } from '../lib/pine/types';
import { getStrategy, strategies } from '../lib/backtest/strategies';
import { useStore } from '../state/store';

export function BacktestTab() {
  const btConfig = useStore((s) => s.btConfig);
  const btRunning = useStore((s) => s.btRunning);
  const btError = useStore((s) => s.btError);
  const candles = useStore((s) => s.candles);
  const setBtConfig = useStore((s) => s.setBtConfig);
  const runBacktest = useStore((s) => s.runBacktest);
  const pushToast = useStore((s) => s.pushToast);
  const pineInputs = useStore((s) => s.pineInputs);
  const refreshPineInputs = useStore((s) => s.refreshPineInputs);
  const btResult = useStore((s) => s.btResult);

  const strategy = getStrategy(btConfig.strategyId);

  const isPine = !!strategy.pine;

  useEffect(() => {
    if (!isPine) return;
    const t = setTimeout(() => void refreshPineInputs(), 400);
    return () => clearTimeout(t);
  }, [isPine, btConfig.pineCode, candles.length > 0, refreshPineInputs]);

  const setParam = (key: string, value: number) => {
    setBtConfig({ params: { ...btConfig.params, [key]: value } });
  };

  return (
    <div>
      <div className="form-grid">
        <label className="form-field" style={{ gridColumn: 'span 2' }}>
          <span>Strategy</span>
          <select
            value={btConfig.strategyId}
            onChange={(e) => {
              const next = getStrategy(e.target.value);
              const params = Object.fromEntries(next.params.map((p) => [p.key, p.default]));
              setBtConfig({ strategyId: next.id, params, ...(next.pine && btConfig.pineCode === undefined && { pineCode: DEFAULT_PINE_CODE }) });
            }}
          >
            {strategies.map((s) => (
              <option key={s.id} value={s.id} title={s.description}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        {isPine && pineInputs.filter(isTunable).map((i) => <PineInputField key={i.name} input={i} value={btConfig.params[i.name]} onChange={(v) => setParam(i.name, v)} />)}

        {strategy.params.map((p) =>
          p.type === 'select' ? (
            <label className="form-field" key={p.key}>
              <span>{p.label}</span>
              <select value={btConfig.params[p.key] ?? p.default} onChange={(e) => setParam(p.key, Number(e.target.value))}>
                {p.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <label className="form-field" key={p.key} title={p.hint}>
              <span>{p.label}</span>
              <input
                type="number"
                value={btConfig.params[p.key] ?? p.default}
                min={p.min}
                max={p.max}
                step={p.step ?? (p.type === 'int' ? 1 : 0.1)}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setParam(p.key, v);
                }}
              />
            </label>
          ),
        )}

        <label className="form-field">
          <span>Initial capital ($){isPine && ' (script wins)'}</span>
          <input
            type="number"
            min={1}
            value={btConfig.initialCapital}
            onChange={(e) => setBtConfig({ initialCapital: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
        <label className="form-field">
          <span>Position size (% equity){isPine && ' (set in script)'}</span>
          <input disabled={isPine}
            type="number"
            min={1}
            max={100}
            value={btConfig.positionSizePct}
            onChange={(e) => setBtConfig({ positionSizePct: Math.min(100, Math.max(1, Number(e.target.value) || 100)) })}
          />
        </label>
        <label className="form-field">
          <span>Fee (bps per side){isPine && ' (script wins)'}</span>
          <input
            type="number"
            min={0}
            value={btConfig.feeBps}
            onChange={(e) => setBtConfig({ feeBps: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
        <label className="form-field">
          <span>Slippage (bps){isPine && ' (set in script)'}</span>
          <input disabled={isPine}
            type="number"
            min={0}
            value={btConfig.slippageBps}
            onChange={(e) => setBtConfig({ slippageBps: Math.max(0, Number(e.target.value) || 0) })}
          />
        </label>
        <label className="form-field">
          <span>Stop loss (%){isPine && ' (set in script)'}</span>
          <input disabled={isPine}
            type="number"
            min={0}
            placeholder="off"
            value={btConfig.stopLossPct ?? ''}
            onChange={(e) => setBtConfig({ stopLossPct: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
          />
        </label>
        <label className="form-field">
          <span>Take profit (%){isPine && ' (set in script)'}</span>
          <input disabled={isPine}
            type="number"
            min={0}
            placeholder="off"
            value={btConfig.takeProfitPct ?? ''}
            onChange={(e) => setBtConfig({ takeProfitPct: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })}
          />
        </label>
        <label className="form-field">
          <span>Shorts{isPine && ' (set in script)'}</span>
          <select disabled={isPine} value={btConfig.allowShort ? 'yes' : 'no'} onChange={(e) => setBtConfig({ allowShort: e.target.value === 'yes' })}>
            <option value="no">Disabled</option>
            <option value="yes">Enabled</option>
          </select>
        </label>
      </div>

      {strategy.custom && (
        <div className="mt-3">
          <CustomCodeEditor
            code={btConfig.customCode ?? DEFAULT_CUSTOM_CODE}
            onChange={(code) => setBtConfig({ customCode: code })}
          />
          <CustomParamsEditor params={btConfig.params} onChange={(params) => setBtConfig({ params })} />
        </div>
      )}

      {isPine && (
        <div className="mt-3">
          <PineCodeEditor
            code={btConfig.pineCode ?? DEFAULT_PINE_CODE}
            onChange={(code) => setBtConfig({ pineCode: code })}
          />
        </div>
      )}

      <div className="row mt-3 wrap">
        <button className="primary" disabled={btRunning || candles.length < 3} onClick={() => void runBacktest()}>
          {btRunning ? (
            <>
              <span className="spinner" style={{ marginRight: 8 }} />
              Running…
            </>
          ) : (
            '▶ Run backtest'
          )}
        </button>
        <span className="hint">
          {candles.length >= 3
            ? `${candles.length} bars · signals execute at the next bar's open · fees & slippage applied`
            : 'Load data first (provider above or CSV import).'}
        </span>
      </div>

      {btError && (
        <div className="mt-2" style={{ color: 'var(--red)', fontSize: 12.5 }}>
          {btError}
        </div>
      )}
      {isPine && (
        <div className="hint mt-2">
          Pine scripts run in a Web Worker with Pine's own order emulation. Initial capital and commission from the script's{' '}
          <code>strategy()</code> call win over the fields above; otherwise those fields are used.
          {btResult && btResult.config.strategyId === 'pine' && (
            <> Last run used capital ${btResult.config.initialCapital} and a fee of {btResult.config.feeBps} bps per side.</>
          )}
        </div>
      )}
      {strategy.custom && (
        <div className="hint mt-2">
          Custom code runs in a Web Worker. Return an array of <code>1 / 0 / -1 / null</code> values (one per bar).{' '}
          <button
            className="ghost"
            style={{ fontSize: 12 }}
            onClick={() => {
              setBtConfig({ customCode: DEFAULT_CUSTOM_CODE });
              pushToast('info', 'Custom code reset to the default example.');
            }}
          >
            Reset example
          </button>
        </div>
      )}
    </div>
  );
}

function CustomCodeEditor({ code, onChange }: { code: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="section-title">Strategy code</div>
      <textarea
        className="code-editor"
        spellCheck={false}
        value={code}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="form-row mt-2">
        <span className="hint">Examples:</span>
        {CUSTOM_STRATEGY_EXAMPLES.map((ex) => (
          <button key={ex.name} onClick={() => onChange(ex.code)} title="Load this example">
            {ex.name}
          </button>
        ))}
      </div>
    </div>
  );
}

function CustomParamsEditor({ params, onChange }: { params: Record<string, number>; onChange: (p: Record<string, number>) => void }) {
  const visible = Object.fromEntries(Object.entries(params).filter(([k]) => !k.startsWith('__')));
  const [text, setText] = useState(() => JSON.stringify(visible, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(JSON.stringify(visible, null, 2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Object.keys(params).length]);

  return (
    <div className="mt-3">
      <div className="section-title">Parameters passed to your code (JSON)</div>
      <textarea
        className="code-editor"
        style={{ minHeight: 80 }}
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            const parsed = JSON.parse(e.target.value) as Record<string, unknown>;
            const numeric: Record<string, number> = {};
            for (const [k, v] of Object.entries(parsed)) {
              const n = Number(v);
              if (Number.isFinite(n)) numeric[k] = n;
            }
            setError(null);
            onChange({ ...params, ...numeric });
          } catch {
            setError('Invalid JSON — fix it to apply.');
          }
        }}
      />
      {error && <div className="hint" style={{ color: 'var(--red)' }}>{error}</div>}
    </div>
  );
}

function isTunable(i: PineInput): boolean {
  return i.type === 'int' || i.type === 'float' || i.type === 'bool';
}

function PineInputField({ input, value, onChange }: { input: PineInput; value: number | undefined; onChange: (v: number) => void }) {
  const def = typeof input.defval === 'number' ? input.defval : input.defval === true ? 1 : 0;
  const current = value ?? def;
  if (input.type === 'bool') {
    return (
      <label className="form-field">
        <span>{input.name}</span>
        <select value={current ? 'yes' : 'no'} onChange={(e) => onChange(e.target.value === 'yes' ? 1 : 0)}>
          <option value="yes">On</option>
          <option value="no">Off</option>
        </select>
      </label>
    );
  }
  return (
    <label className="form-field">
      <span>{input.name}</span>
      <input
        type="number"
        value={current}
        min={input.minval}
        max={input.maxval}
        step={input.step ?? (input.type === 'int' ? 1 : 0.1)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

function PineCodeEditor({ code, onChange }: { code: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="section-title">Pine Script strategy</div>
      <textarea className="code-editor" spellCheck={false} value={code} onChange={(e) => onChange(e.target.value)} />
      <div className="form-row mt-2">
        <span className="hint">Examples:</span>
        {PINE_STRATEGY_EXAMPLES.map((ex) => (
          <button key={ex.name} onClick={() => onChange(ex.code)} title="Load this example">
            {ex.name}
          </button>
        ))}
      </div>
    </div>
  );
}
