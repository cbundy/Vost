import { useEffect } from 'react';
import { fmtNum } from '../lib/format';
import { getProvider } from '../lib/providers';
import { CARD_BARS, cardStats } from '../lib/quotes';
import { quoteKey, useQuotes } from '../state/quotes';
import { useStore } from '../state/store';
import { useChart } from '../state/chartContext';

/** Summary of the chart's symbol from its daily bars; shows only what can be computed. */
export function SymbolCard() {
  const providerId = useChart((s) => s.providerId);
  const symbol = useChart((s) => s.symbol);
  const lists = useStore((s) => s.watchlists.lists);
  const entry = useQuotes((s) => s.entries[quoteKey(providerId, symbol)]);

  useEffect(() => {
    useQuotes.getState().setWanted('card', [{ providerId, symbol, bars: CARD_BARS }]);
    return () => useQuotes.getState().setWanted('card', []);
  }, [providerId, symbol]);

  const provider = getProvider(providerId);
  const label =
    lists.flatMap((l) => l.sections.flatMap((s) => s.items)).find((i) => i.providerId === providerId && i.symbol === symbol)?.label ||
    provider.popularSymbols.find((p) => p.symbol === symbol)?.label ||
    symbol;
  const stats = entry && entry.asked >= CARD_BARS ? cardStats(entry.bars, Date.now() / 1000) : null;
  const sign = stats && stats.chg >= 0 ? 'pos' : 'neg';

  return (
    <div className="symbol-card" aria-label="Symbol summary">
      <div className="sc-title">
        <strong>{symbol}</strong>
        <span className="sc-sub">{provider.name}</span>
      </div>
      {label !== symbol && <div className="sc-sub">{label}</div>}
      {stats ? (
        <>
          <div className="sc-price">
            <span className="sc-last">{fmtNum(stats.last)}</span>
            <span className={sign}>{stats.chg >= 0 ? '+' : ''}{fmtNum(stats.chg)}</span>
            <span className={sign}>{stats.chgPct >= 0 ? '+' : ''}{stats.chgPct.toFixed(2)}%</span>
          </div>
          {stats.volRatio !== null && (
            <div className="sc-card-row">
              <span>Volume</span>
              <span className="sc-vol">
                <span className="sc-vol-bar"><span className="sc-vol-fill" style={{ width: `${Math.min(100, (stats.volRatio / 2) * 100)}%` }} /></span>
                {stats.volRatio.toFixed(1)}x avg
              </span>
            </div>
          )}
          <div className="sc-card-row"><span>Day range</span><span>{fmtNum(stats.dayLow)} - {fmtNum(stats.dayHigh)}</span></div>
          {stats.high52 !== null && stats.low52 !== null && (
            <div className="sc-card-row"><span>52-week range</span><span>{fmtNum(stats.low52)} - {fmtNum(stats.high52)}</span></div>
          )}
        </>
      ) : (
        <div className="sc-sub">{entry ? 'No daily data' : 'Loading...'}</div>
      )}
    </div>
  );
}
