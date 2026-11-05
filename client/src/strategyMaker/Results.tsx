import { getStrategy } from '../lib/backtest/strategies';
import type { Candidate, CandidateStats, Gap, TrainResult } from './engine';
import type { FindResult } from './run';
import { tooFewMessage } from './run';
import { familyName } from './TargetsForm';

export const candidateKey = (c: Pick<Candidate, 'strategyId' | 'params'>): string => `${c.strategyId}|${JSON.stringify(c.params)}`;

const MODE_NAMES = ['Breakout', 'Reversion'];

/** For example `fast 8, slow 34`; the direction is the form's, so it is left out. */
export function settingsText(c: Pick<Candidate, 'strategyId' | 'params'>): string {
  const specs = getStrategy(c.strategyId).params;
  return Object.entries(c.params)
    .filter(([k]) => k !== 'direction')
    .map(([k, v]) => `${(specs.find((p) => p.key === k)?.label ?? k).toLowerCase()} ${k === 'mode' ? (MODE_NAMES[v] ?? v) : v}`)
    .join(', ');
}

const pct = (v: number | null, d = 1): string => (v == null || !Number.isFinite(v) ? 'n/a' : `${v.toFixed(d)}%`);
const share = (v: number): string => (v > 0 && v < 0.005 ? '<1%' : pct(v * 100, 0));
const rr = (v: number | null): string => (v == null || !Number.isFinite(v) ? 'n/a' : v.toFixed(2));

const GAP_WORDS: Record<Gap['metric'], (g: Gap) => string> = {
  minRR: (g) => `The win-to-loss ratio (R:R) is ${rr(g.actual)}, you asked for at least ${g.target}.`,
  minHitRatePct: (g) => `The hit rate is ${pct(g.actual)}, you asked for at least ${g.target}%.`,
  maxDrawdownPct: (g) => `The largest drawdown is ${pct(g.actual)}, you asked for at most ${g.target}%.`,
};
export const gapWords = (g: Gap): string => GAP_WORDS[g.metric](g);

const CHECK_NAMES: Record<string, string> = {
  'held-out': 'Held-out data',
  'walk-forward': 'Walk-forward',
  robustness: 'Nearby settings',
  'monte-carlo': 'Monte Carlo',
};

function Stats({ s }: { s: CandidateStats }) {
  return (
    <>
      <td>{pct(s.totalReturnPct)}</td>
      <td>{pct(s.winRatePct, 0)}</td>
      <td>{rr(s.rr)}</td>
      <td>{pct(s.maxDrawdownPct)}</td>
      <td>{s.trades}</td>
    </>
  );
}

interface ModelBlockProps {
  model: Pick<TrainResult, 'heldOut' | 'rules' | 'importance'> & { model: { trainedOn: { trades: number } } };
}

/** What the model learned: its rules, importance and held-out report. */
export function ModelBlock({ model }: ModelBlockProps) {
  return (
    <div className="sm-res-block">
      <h3>What explains your trades</h3>
      <p className="sm-note">
        Learned from {model.model.trainedOn.trades} trades. On bars it had not seen, it called the right state {pct(model.heldOut.accuracy * 100, 0)} of the
        time (entry and exit match F1 {model.heldOut.f1.toFixed(2)}).
      </p>
      <ul className="sm-rules">
        {model.rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <p className="sm-note">
        Importance by family:{' '}
        {model.importance.byFamily.length
          ? model.importance.byFamily.map((f) => `${familyName(f.family)} ${share(f.importance)}`).join(', ')
          : 'none (the model found no pattern)'}
        .
      </p>
      {model.importance.byFeature.length > 0 && (
        <p className="sm-note">Top readings: {model.importance.byFeature.slice(0, 4).map((f) => `${f.label} ${share(f.importance)}`).join(', ')}.</p>
      )}
    </div>
  );
}

interface Props {
  result: FindResult;
  selected: string | null;
  onSelect: (c: Candidate | null) => void;
}

export function Results({ result, selected, onSelect }: Props) {
  const { outcome, skippedSets, seriesLabels } = result;
  const skippedBlock = skippedSets.length > 0 && (
    <div className="sm-res-block">
      <h3>Skipped sets</h3>
      <ul>
        {skippedSets.map((s) => (
          <li key={s.label}>
            {s.label}: {s.reason}
          </li>
        ))}
      </ul>
    </div>
  );
  if (outcome.kind === 'too-few') {
    return (
      <section className="sm-results" aria-label="Results">
        <p role="alert">{tooFewMessage(outcome.have, outcome.need)}</p>
        {skippedBlock}
      </section>
    );
  }
  if (outcome.kind === 'refused') {
    return (
      <section className="sm-results" aria-label="Results">
        <p role="alert">{outcome.reason}</p>
        {skippedBlock}
      </section>
    );
  }
  const { model, search } = outcome;
  const v = search.validation;
  const best = search.bestMeetingTargets ?? search.bestMatch;
  const headline = search.bestMeetingTargets
    ? `Found ${getStrategy(best.strategyId).name} (${settingsText(best)}), which meets your targets.`
    : `No setting met your targets. The closest is ${getStrategy((search.closest ?? best).strategyId).name} (${settingsText(search.closest ?? best)}).`;
  return (
    <section className="sm-results" aria-label="Results">
      <p className="sm-headline">{headline}</p>

      <ModelBlock model={model} />

      <div className="sm-res-block">
        <h3>Ranked settings</h3>
        <div className="sm-table-wrap">
          <table className="sm-table">
            <thead>
              <tr>
                <th rowSpan={2}>Strategy</th>
                <th rowSpan={2}>Match F1</th>
                <th colSpan={5}>In sample</th>
                <th colSpan={5}>Held out</th>
              </tr>
              <tr>
                {['Return', 'Hit rate', 'R:R', 'Max DD', 'Trades', 'Return', 'Hit rate', 'R:R', 'Max DD', 'Trades'].map((h, i) => (
                  <th key={i}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {search.recommendations.map((c) => {
                const key = candidateKey(c);
                const labels = [
                  c === search.bestMatch && 'Best match',
                  c === search.bestMeetingTargets && 'Best meeting targets',
                  !c.meetsTargets && 'Misses targets',
                ].filter(Boolean) as string[];
                return (
                  <tr key={key} className={selected === key ? 'sm-selected' : undefined}>
                    <td>
                      <button type="button" className="sm-pick" aria-pressed={selected === key} onClick={() => onSelect(selected === key ? null : c)} title="Show its trades on the chart">
                        {getStrategy(c.strategyId).name}
                      </button>
                      <div className="sm-bars">{settingsText(c)}</div>
                      {labels.map((l) => (
                        <span key={l} className={`sm-badge${l === 'Misses targets' ? ' sm-badge-miss' : ''}`}>
                          {l}
                        </span>
                      ))}
                    </td>
                    <td>{c.match.f1.toFixed(2)}</td>
                    <Stats s={c.selection} />
                    <Stats s={c.heldOut} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="sm-note">Click a strategy to draw the trades it takes on the chart.</p>
      </div>

      <div className="sm-res-block">
        <h3>
          <span className={v.validated ? 'sm-ok' : 'sm-bad'}>{v.validated ? 'Validated' : 'Not validated'}</span>
        </h3>
        <p className="sm-note">
          Checks on {getStrategy(v.candidate.strategyId).name} ({settingsText(v.candidate)}), on data it was not chosen on.
        </p>
        <ul className="sm-checks">
          {v.checks.map((c) => (
            <li key={c.id}>
              <span className={c.passed ? 'sm-ok' : 'sm-bad'}>{c.passed ? 'Passed' : 'Failed'}</span> <strong>{CHECK_NAMES[c.id] ?? c.id}</strong> - {c.detail}
            </li>
          ))}
        </ul>
        {v.heldOutGaps.length > 0 && (
          <ul>
            {v.heldOutGaps.map((g) => (
              <li key={g.metric}>On held-out data: {gapWords(g)}</li>
            ))}
          </ul>
        )}
      </div>

      {search.closest && (
        <div className="sm-res-block">
          <h3>Closest found</h3>
          <p className="sm-note">
            {getStrategy(search.closest.strategyId).name} ({settingsText(search.closest)}) misses your targets:
          </p>
          <ul>
            {search.closest.gaps.map((g) => (
              <li key={g.metric}>{gapWords(g)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="sm-res-block sm-limits">
        <h3>What this can and cannot tell you</h3>
        <ul>
          <li>Few trades prove little: {search.usedTrades} were used here, and a result built on a few dozen can be luck.</li>
          <li>Your highlights are drawn with hindsight, so they show where the price went, not what you could have known then.</li>
          <li>Fees and slippage are always on, with the values you set above.</li>
        </ul>
      </div>

      {(search.skipped.length > 0 || skippedSets.length > 0) && (
        <>
          {skippedBlock}
          {search.skipped.length > 0 && (
            <div className="sm-res-block">
              <h3>Skipped trades</h3>
              <ul>
                {search.skipped.map((s) => (
                  <li key={`${s.series}-${s.index}`}>
                    {seriesLabels[s.series] ?? `Chart ${s.series + 1}`}, trade {s.index + 1}: {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
