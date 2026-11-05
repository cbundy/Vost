import { barCount, type HighlightTrade } from './brush';

const fmt = (t: number) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');

interface Props {
  trades: readonly HighlightTrade[];
  times: readonly number[];
  onFocus: (t: HighlightTrade) => void;
  onDelete: (t: HighlightTrade) => void;
}

export function TradeList({ trades, times, onFocus, onDelete }: Props) {
  if (!trades.length) return <p className="sm-note sm-list-empty">No trades marked yet. Pick a brush and drag across bars.</p>;
  return (
    <ul className="sm-list" aria-label="Marked trades">
      {trades.map((t) => (
        <li key={`${t.entryTime}-${t.exitTime}`} className="sm-row">
          <button type="button" className="sm-row-main" onClick={() => onFocus(t)} title="Show on the chart">
            <span className={`sm-tag sm-tag-${t.side}`}>{t.side}</span>
            <span>
              {fmt(t.entryTime)} to {fmt(t.exitTime)}
            </span>
            <span className="sm-bars">{barCount(times, t)} bars</span>
          </button>
          <button type="button" className="sm-row-del" aria-label={`Delete ${t.side} trade from ${fmt(t.entryTime)}`} onClick={() => onDelete(t)}>
            x
          </button>
        </li>
      ))}
    </ul>
  );
}
