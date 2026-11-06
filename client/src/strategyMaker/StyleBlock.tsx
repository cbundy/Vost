import { STYLE_NAMES, type StyleReport, type TradeStyleLabel } from './engine';
import { familyName } from './TargetsForm';

const ORDER: TradeStyleLabel[] = ['trend', 'continuation', 'mean_reversion', 'reversal', 'breakout', 'momentum', 'unclear'];

export const styleName = (s: TradeStyleLabel): string => STYLE_NAMES[s];

/** The key a trade is looked up by on the chart's list. */
export const styleKey = (side: string, entryTime: number): string => `${side}|${entryTime}`;

/** "The style of your trades": the mix, what the search did, and each trade's style with its reason. */
export function StyleBlock({ style, seriesLabels }: { style: StyleReport; seriesLabels: string[] }) {
  const total = style.trades.length;
  const mix = ORDER.filter((k) => style.counts[k] > 0).sort((a, b) => style.counts[b] - style.counts[a]);
  const names = style.leading.map((s) => styleName(s).replace(/^trend following$/, 'trend'));
  return (
    <div className="sm-res-block sm-style" aria-label="The style of your trades">
      <h3>The style of your trades</h3>
      {total === 0 ? (
        <p className="sm-note">No trades could be read.</p>
      ) : (
        <ul>
          {mix.map((k) => (
            <li key={k}>
              {style.counts[k]} of {total} {k === 'unclear' ? 'show no clear style' : `look like ${styleName(k)}`}
            </li>
          ))}
        </ul>
      )}
      <p className="sm-note">
        {style.applied
          ? `Searched the ${names.join(' and ')} families: ${style.families.map(familyName).join(', ')}.`
          : (style.note ?? 'The style of your trades was not used, so every allowed family was searched.')}
      </p>
      {total > 0 && (
        <details>
          <summary>Each trade</summary>
          <ul>
            {style.trades.map((t) => (
              <li key={`${t.series}-${t.index}`}>
                {seriesLabels[t.series] ?? `Chart ${t.series + 1}`}, trade {t.index + 1} ({t.side}): {styleName(t.style)} - {t.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
