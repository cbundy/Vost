import type { TradeStyleLabel } from './engine';
import { styleKey, styleName } from './StyleBlock';
import { barCount, type HighlightTrade } from './brush';

const fmt = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');

interface Props {
  trades: readonly HighlightTrade[];
  times: readonly number[];
  onFocus: (t: HighlightTrade) => void;
  onDelete: (t: HighlightTrade) => void;
  /** The latest result's style of each mark, by `side|entryTime`. */
  styles?: ReadonlyMap<string, { style: TradeStyleLabel; reason: string }>;
}

export function TradeList({ trades, times, onFocus, onDelete, styles }: Props) {
  if (!trades.length) return <p className="sm-note sm-list-empty">No trades marked yet. Pick a brush and drag across bars.</p>;
  return (
    <ul className="sm-list" aria-label="Marked trades">
      {trades.map((t) => (
        <li key={`${t.entryTime}-${t.exitTime}`} className="sm-row">
          <button type="button" className="sm-row-main" onClick={() => onFocus(t)} title="Show on the chart">
            <span className={`sm-tag sm-tag-${t.side}`}>{t.side}</span>
            <span className="sm-when">
              {fmt(t.entryTime)} to {fmt(t.exitTime)}
            </span>
            <span className="sm-bars">{barCount(times, t)} bars</span>
            {(() => {
              const st = styles?.get(styleKey(t.side, t.entryTime));
              return st && <span className={`sm-tag sm-tag-style sm-tag-style-${st.style}`} title={st.reason}>{styleName(st.style)}</span>;
            })()}
          </button>
          <button type="button" className="sm-row-del" aria-label={`Delete ${t.side} trade from ${fmt(t.entryTime)}`} onClick={() => onDelete(t)}>
            x
          </button>
        </li>
      ))}
    </ul>
  );
}
