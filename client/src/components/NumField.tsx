import { useEffect, useState } from 'react';

/** A number input that keeps what is typed and only passes on a finite value in range; anything else is refused in place. */
export function NumField({ label, value, min, max, step, onCommit, refusal = 'That would put a point on the wrong side of the entry.' }: { label: string; value: number; min?: number; max?: number; step?: number; onCommit(n: number): boolean | void; refusal?: string }) {
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<string | null>(null);
  const change = (raw: string) => {
    setText(raw);
    const n = raw.trim() === '' ? NaN : Number(raw);
    if (!Number.isFinite(n)) return setError('Enter a finite number.');
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) return setError(`Enter a number from ${min ?? '-∞'} to ${max ?? '∞'}.`);
    // A commit that returns false is refused by the drawing (a target moved across its entry): the text stays, flagged.
    setError(onCommit(n) === false ? refusal : null);
  };
  // Another field's edit may move this value (a position's target and stop share one time): show it.
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : String(value)));
  }, [value]);
  return (
    <span className="ds-num">
      <input type="number" value={text} min={min} max={max} step={step ?? 'any'} aria-label={label} aria-invalid={error != null} onChange={(e) => change(e.target.value)} />
      {error && (
        <span className="ds-error" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}
