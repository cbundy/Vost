import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { pickerTimeframes } from '../lib/customTimeframes';
import { getProvider } from '../lib/providers';
import { joinColor, layoutInputs, splitColor, timeframeOptions, timeToUtcText, utcTextToTime } from '../lib/pine/inputs';
import type { PineInput, PineInputValue } from '../lib/pine/types';
import { useStore } from '../state/store';
import { useChart } from '../state/chartContext';

type OnChange = (v: PineInputValue) => void;

/** A script's inputs in its own groups and rows. `valueOf` gives an input's current value (null = the script's default). */
export function PineInputList({
  inputs,
  valueOf,
  onChange,
  className,
}: {
  inputs: readonly PineInput[];
  valueOf: (input: PineInput) => PineInputValue | null;
  onChange: (input: PineInput, v: PineInputValue) => void;
  className?: string;
}) {
  const sections = layoutInputs(inputs);
  return (
    <div className={`pine-inputs${className ? ` ${className}` : ''}`}>
      {sections.map((s) => (
        <section className="pine-input-group" key={s.group ?? ''} aria-label={s.group ?? undefined}>
          {s.group && <h4 className="pine-input-heading">{s.group}</h4>}
          {s.rows.map((row) => (
            <div className="pine-input-row" key={row.inputs[0].name}>
              {row.inputs.map((inp) => (
                <PineInputControl key={inp.name} input={inp} value={valueOf(inp)} onChange={(v) => onChange(inp, v)} />
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

/** One Pine input: the control that fits its type, with the script's tooltip as a hint on the label. */
export function PineInputControl({ input, value, onChange }: { input: PineInput; value: PineInputValue | null; onChange: OnChange }) {
  const id = useId();
  const tip = input.tooltip;
  return (
    <div className={`pine-input pine-input-${input.type}`}>
      <label htmlFor={id} title={tip} className="pine-input-label">
        {input.name}
        {tip && (
          <span className="pine-info" role="img" aria-label={`${input.name}: ${tip}`} title={tip}>
            i
          </span>
        )}
      </label>
      <InputField id={id} input={input} value={value} onChange={onChange} />
    </div>
  );
}

function InputField({ id, input, value, onChange }: { id: string; input: PineInput; value: PineInputValue | null; onChange: OnChange }) {
  if (input.type === 'timeframe') return <TimeframeField id={id} value={String(value ?? '')} onChange={onChange} />;
  if (input.options && input.options.length > 0) {
    return (
      <select id={id} value={String(value ?? '')} onChange={(ev) => onChange(input.options!.find((o) => String(o) === ev.target.value) ?? ev.target.value)}>
        {input.options.map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    );
  }
  switch (input.type) {
    case 'bool':
      return <input id={id} type="checkbox" checked={Boolean(value)} onChange={(ev) => onChange(ev.target.checked)} />;
    case 'color':
      return <ColorField id={id} name={input.name} value={String(value ?? '')} onChange={onChange} />;
    case 'time': {
      const ms = typeof value === 'number' ? value : Number(value);
      return (
        <span className="pine-input-time">
          <input
            id={id}
            type="datetime-local"
            value={timeToUtcText(ms)}
            onChange={(ev) => {
              const t = utcTextToTime(ev.target.value);
              if (t !== null) onChange(t);
            }}
          />
          <span className="pine-input-unit">UTC</span>
        </span>
      );
    }
    case 'symbol':
      return <SymbolField id={id} value={String(value ?? '')} onChange={onChange} />;
    case 'text_area':
      return <textarea id={id} rows={3} value={String(value ?? '')} onChange={(ev) => onChange(ev.target.value)} />;
    case 'int':
    case 'float':
    case 'price':
      return (
        <input
          id={id}
          type="number"
          value={typeof value === 'number' ? value : ''}
          min={input.minval}
          max={input.maxval}
          step={input.step ?? (input.type === 'int' ? 1 : 0.1)}
          onChange={(ev) => {
            const v = Number(ev.target.value);
            if (ev.target.value !== '' && Number.isFinite(v)) onChange(v);
          }}
        />
      );
    default:
      return <input id={id} type="text" value={String(value ?? '')} onChange={(ev) => onChange(ev.target.value)} />;
  }
}

function ColorField({ id, name, value, onChange }: { id: string; name: string; value: string; onChange: OnChange }) {
  const { hex, alpha } = splitColor(value);
  return (
    <span className="pine-input-color">
      <input id={id} type="color" value={hex} onChange={(ev) => onChange(joinColor(ev.target.value, alpha))} />
      <input
        type="range"
        min={0}
        max={255}
        value={alpha}
        aria-label={`${name} opacity`}
        title={`Opacity ${Math.round((alpha / 255) * 100)}%`}
        onChange={(ev) => onChange(joinColor(hex, Number(ev.target.value)))}
      />
    </span>
  );
}

function TimeframeField({ id, value, onChange }: { id: string; value: string; onChange: OnChange }) {
  const providerId = useChart((s) => s.providerId);
  const custom = useStore((s) => s.customTimeframes);
  const build = useStore((s) => s.buildTimeframes);
  const provider = getProvider(providerId);
  const intervals = pickerTimeframes(provider, custom, build && !provider.offline ? 'built' : 'native').map((e) => e.interval);
  const options = timeframeOptions(intervals, value);
  return (
    <select id={id} value={value} onChange={(ev) => onChange(ev.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** A symbol text field with the provider's suggestions. It searches the provider itself and never touches the chart's symbol. */
function SymbolField({ id, value, onChange }: { id: string; value: string; onChange: OnChange }) {
  const providerId = useChart((s) => s.providerId);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const list = `${id}-symbols`;
  const seq = useRef(0);
  const provider = useMemo(() => getProvider(providerId), [providerId]);
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(() => {
      const found = provider.searchSymbols ? provider.searchSymbols(value) : Promise.resolve(provider.popularSymbols);
      found
        .then((s) => {
          if (n === seq.current) setSuggestions(s.map((x) => x.symbol).slice(0, 30));
        })
        .catch(() => {
          if (n === seq.current) setSuggestions(provider.popularSymbols.map((x) => x.symbol));
        });
    }, 250);
    return () => clearTimeout(t);
  }, [value, provider]);
  return (
    <>
      <input id={id} type="text" list={list} value={value} spellCheck={false} onChange={(ev) => onChange(ev.target.value)} />
      <datalist id={list}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}
