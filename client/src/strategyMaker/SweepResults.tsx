import { useMemo, useState } from 'react';
import { getStrategy } from '../lib/backtest/strategies';
import { encodeHandoff } from '../lib/backtestHandoff';
import { gapWords, settingsText, SignalsCell } from './Results';
import { familyName } from './TargetsForm';
import type { ClosestCandidate, PartFigures, SweepCandidate, SweepResult, SweepRisk } from './sweep/types';
import { marketLabel, sweepHandoff } from './sweepHandoff';

const SHOWN_STEP = 100;

const pct = (v: number | null, d = 1): string => (v == null || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(d)}%`);
const ratio = (v: number | null): string => (v == null || !Number.isFinite(v) ? 'n/a' : v.toFixed(2));
const money = (v: number): string => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
const count = (n: number): string => n.toLocaleString('en-US');

/** For example `fast 8, slow 34, long and short`; a long-only setting says nothing of direction. */
export function settingsWords(c: Pick<SweepCandidate, 'strategyId' | 'params'>): string {
  const dir = c.params.direction === 2 ? 'short only' : c.params.direction === 3 ? 'long and short' : '';
  return [settingsText(c), dir].filter(Boolean).join(', ');
}

/** The figures a row shows: the unseen part for a held row, the searched part otherwise. */
const figuresOf = (c: SweepCandidate): PartFigures => (c.held ? c.heldOut : c.selection);

type SortKey = 'market' | 'timeframe' | 'strategy' | 'stop' | 'trades' | 'signals' | 'hit' | 'rr' | 'equity' | 'drawdown' | 'held';

const COLUMNS: Array<{ key: SortKey; label: string; value: (c: SweepCandidate) => number | string }> = [
  { key: 'market', label: 'Market', value: (c) => c.market.symbol },
  { key: 'timeframe', label: 'Timeframe', value: (c) => c.timeframe },
  { key: 'strategy', label: 'Strategy', value: (c) => getStrategy(c.strategyId).name },
  { key: 'stop', label: 'Stop / take profit', value: (c) => c.stopLossPct },
  { key: 'trades', label: 'Trades', value: (c) => figuresOf(c).trades },
  { key: 'signals', label: 'Signals / 100 bars', value: (c) => figuresOf(c).signalsPer100Bars ?? -1 },
  { key: 'hit', label: 'Hit rate', value: (c) => figuresOf(c).winRatePct ?? -1 },
  { key: 'rr', label: 'R:R', value: (c) => figuresOf(c).rr ?? -1 },
  { key: 'equity', label: 'Final equity', value: (c) => figuresOf(c).finalEquity },
  { key: 'drawdown', label: 'Max drawdown', value: (c) => figuresOf(c).maxDrawdownPct },
  { key: 'held', label: 'Held on unseen data', value: (c) => Number(c.held) },
];

const fix = (v: number | null, d: number): string => (v == null ? 'n/a' : v.toFixed(d));

/** The figures of the part a row does not show, so both parts are readable. */
function otherSignals(c: SweepCandidate): string {
  const o = c.held ? c.selection : c.heldOut;
  return `${c.held ? 'Searched part' : 'Unseen part'}: ${fix(o.signalsPer100Bars, 1)} per 100 bars, ${o.signalsFired ?? 'n/a'} fired, ${fix(o.signalsPerDay, 2)} per day`;
}

function Closest({ list }: { list: ClosestCandidate[] }) {
  return (
    <div className="sm-res-block">
      <h3>Closest found</h3>
      <p className="sm-note">Nothing met a target on these markets; this is the nearest setting on each.</p>
      <ul>
        {list.map((c) => (
          <li key={`${marketLabel(c)}`}>
            <strong>{marketLabel(c)}</strong>: {getStrategy(c.strategyId).name} ({settingsWords(c)}), stop {pct(c.stopLossPct, 2)}, take profit {pct(c.takeProfitPct, 2)}.{' '}
            {c.gaps.map((g) => gapWords(g)).join(' ')}
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Props {
  result: SweepResult;
  risk: SweepRisk;
}

/** The ranked table of a market search, what came closest, what was skipped, and a plain warning about luck. */
export function SweepResults({ result, risk }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null);
  const [shown, setShown] = useState(SHOWN_STEP);
  const rows = useMemo(() => {
    if (!sort) return result.candidates;
    const col = COLUMNS.find((c) => c.key === sort.key)!;
    const dir = sort.desc ? -1 : 1;
    return [...result.candidates].sort((a, b) => {
      const x = col.value(a);
      const y = col.value(b);
      return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * dir;
    });
  }, [result.candidates, sort]);
  const open = (c: SweepCandidate) => window.open('/' + encodeHandoff(sweepHandoff(c, risk)), '_blank', 'noopener');
  const onSort = (key: SortKey) => {
    setSort((s) => (s?.key === key ? (s.desc ? null : { key, desc: true }) : { key, desc: false }));
    setShown(SHOWN_STEP);
  };

  return (
    <section className="sm-results" aria-label="Search results">
      <p className="sm-headline">
        Tried {count(result.tried)} combinations: {count(result.met)} met a target, {count(result.held)} also held on unseen data.
      </p>
      <p className="sm-warn" role="note">
        Many combinations were tried, so a result that meets a target can be luck. The ones that held on unseen data - the last part of each market, kept
        out of the search - are the ones to trust more.
      </p>

      {result.candidates.length > 0 ? (
        <div className="sm-res-block">
          <h3>Ranked results</h3>
          <div className="sm-table-wrap" tabIndex={0} role="region" aria-label="Ranked results table">
            <table className="sm-table">
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} aria-sort={sort?.key === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                      <button type="button" className="sm-sort" onClick={() => onSort(c.key)} title={`Sort by ${c.label.toLowerCase()}`}>
                        {c.label}
                        {sort?.key === c.key ? (sort.desc ? ' ▾' : ' ▴') : ''}
                      </button>
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((c) => {
                  const f = figuresOf(c);
                  return (
                    <tr key={`${marketLabel(c)}|${c.strategyId}|${JSON.stringify(c.params)}|${c.stopLossPct}|${c.takeProfitPct}`}>
                      <td>{c.market.symbol}</td>
                      <td>{c.timeframe}</td>
                      <td>
                        {familyName(c.strategyId)}
                        <div className="sm-bars">{settingsWords(c)}</div>
                      </td>
                      <td>
                        {pct(c.stopLossPct, 2)} / {pct(c.takeProfitPct, 2)}
                      </td>
                      <td>{f.trades}</td>
                      <SignalsCell s={f} title={otherSignals(c)} />
                      <td>{pct(f.winRatePct, 0)}</td>
                      <td>{ratio(f.rr)}</td>
                      <td>{money(f.finalEquity)}</td>
                      <td>{pct(f.maxDrawdownPct)}</td>
                      <td>{c.held ? 'yes' : 'no'}</td>
                      <td>
                        <button type="button" onClick={() => open(c)} title={`Open Vost in a new tab on ${marketLabel(c)} with this strategy in the Backtest tab`}>
                          Open in Backtest
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="sm-note">
            Rows held on unseen data show the figures from that unseen part; the others show the part that was searched. Account size {money(risk.initialCapital)},
            risk {risk.riskPct}% per trade. Signals are the times a setting turned to a new side; the trades column counts the ones that were taken.
          </p>
          {rows.length > shown && (
            <button type="button" className="ghost" onClick={() => setShown((n) => n + SHOWN_STEP)}>
              Show {Math.min(SHOWN_STEP, rows.length - shown)} more ({count(rows.length - shown)} not shown)
            </button>
          )}
        </div>
      ) : (
        <p className="sm-note">No setting met a target on the markets that loaded.</p>
      )}

      {result.closest.length > 0 && <Closest list={result.closest} />}

      {result.skipped.length > 0 && (
        <div className="sm-res-block">
          <h3>Skipped</h3>
          <ul>
            {result.skipped.map((s) => (
              <li key={marketLabel(s)}>
                {marketLabel(s)}: {s.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
