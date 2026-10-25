import { fmtTime } from '../lib/format';
import { fromZonedInputValue, toZonedInputValue, type TimeRange } from '../lib/timeRange';

interface Props {
  value: TimeRange;
  onChange(range: TimeRange): void;
  timeZone: string;
  /** Loaded data span; its ends show as the placeholders of the open fields. */
  bounds?: { first: number; last: number };
  label?: string;
  error?: string | null;
}

/** From / To date-time fields in a zone; an empty field is an open end. Holds no store state. */
export function TimeRangePicker({ value, onChange, timeZone, bounds, label = 'Time range', error }: Props) {
  const open = value.from == null && value.to == null;
  const field = (key: 'from' | 'to', title: string) => {
    const t = value[key];
    const bound = bounds ? bounds[key === 'from' ? 'first' : 'last'] : undefined;
    return (
      <label className="form-field">
        <span>{title}</span>
        <input
          type="datetime-local"
          step="60"
          aria-label={`${label} ${title}`}
          value={t == null ? '' : toZonedInputValue(t, timeZone)}
          title={bound != null ? `Data ${key === 'from' ? 'starts' : 'ends'} ${fmtTime(bound, { timeZone })}` : undefined}
          onChange={(e) => onChange({ ...value, [key]: fromZonedInputValue(e.target.value, timeZone) })}
        />
      </label>
    );
  };
  return (
    <div className="time-range">
      <div className="time-range-head">
        <span className="time-range-label">{label}</span>
        <span className="hint">{timeZone}</span>
      </div>
      <div className="time-range-fields">
        {field('from', 'From')}
        {field('to', 'To')}
        <button className="ghost" disabled={open} onClick={() => onChange({ from: null, to: null })}>
          Full data
        </button>
      </div>
      {error && <div className="time-range-error">{error}</div>}
    </div>
  );
}
