/**
 * The fields that edit the rule of a TradingView indicator role (its label, rule type and operands). They hold no state and
 * import nothing from the app, so the Backtest tab and the strategy maker's market search share them.
 */
import type { PineOperand, PineRole, PineRoleLabel, PineRule } from './backtest/pineRole';
import type { PinePlot } from './pine/types';

export const isShapeKind = (p: PinePlot) => p.kind === 'plotshape' || p.kind === 'plotarrow';
export const isLine = (p: PinePlot) => p.kind === 'plot' || p.kind === 'hline';

export const ROLE_LABELS: Array<{ value: PineRoleLabel; text: string }> = [
  { value: 'trend', text: 'Trend' },
  { value: 'volume', text: 'Volume' },
  { value: 'volatility', text: 'Volatility' },
  { value: 'strength', text: 'Trend strength' },
  { value: 'custom', text: 'Custom' },
];

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

const ENTRY_TYPES = [
  { value: 'cross', text: 'Crosses' },
  { value: 'shape', text: 'Shape drawn' },
];

/** The filter label, the rule type and the operands of a role's rule, for the plots the indicator draws. */
export function RuleFields<R extends Omit<PineRole, 'source'>>({ role, plots, onChange }: { role: R; plots: PinePlot[]; onChange: (r: R) => void }) {
  const rule = role.rule;
  const set = (next: PineRule) => onChange({ ...role, rule: next });
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
    <>
      {role.role === 'filter' && (
        <label className="form-field">
          <span>Filter label</span>
          <select aria-label="Filter label" value={role.label ?? 'custom'} onChange={(e) => onChange({ ...role, label: e.target.value as PineRoleLabel })}>
            {ROLE_LABELS.map((l) => (
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
            ENTRY_TYPES.map((t) => (
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
    </>
  );
}
