import { useEffect, useRef, useState } from 'react';
import { getStrategy } from '../lib/backtest/strategies';
import { encodeHandoff } from '../lib/backtestHandoff';
import type { Candidate } from './engine';
import { handoffOf } from './handoffOf';
import { pineStrategyText, settingsPlain } from './pineExport';
import type { FindInputs } from './run';

interface Props {
  candidate: Pick<Candidate, 'strategyId' | 'params'>;
  /** For example `SMA crossover (fast 8, slow 34)`. */
  title: string;
  run: Pick<FindInputs, 'direction' | 'risk'>;
  /** The label of the data the strategy was found on. */
  source: string;
}

/** Open the result in the Backtest tab, or copy its settings or a Pine script. Acts on one result. */
export function ResultActions({ candidate, title, run, source }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    setCopied(null);
    setManual(null);
  }, [candidate]);
  useEffect(() => {
    area.current?.select();
  }, [manual]);

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setManual(null);
      setCopied(what);
    } catch {
      setCopied(null);
      setManual(text);
    }
  };
  const open = () => window.open('/' + encodeHandoff(handoffOf(candidate, run, source)), '_blank', 'noopener');

  return (
    <div className="sm-actions" role="group" aria-label="Use this result">
      <span className="sm-actions-for">For {title}:</span>
      <button type="button" onClick={open} title="Open Vost in a new tab with the Backtest tab filled in with this strategy">
        Open in Backtest
      </button>
      <button type="button" className="ghost" onClick={() => void copy('Settings copied', settingsPlain(candidate, run))}>
        Copy settings
      </button>
      <button
        type="button"
        className="ghost"
        onClick={() => void copy('Pine strategy copied', pineStrategyText(candidate, run))}
        title={`A Pine v6 script of ${getStrategy(candidate.strategyId).name} with these settings`}
      >
        Copy as Pine strategy
      </button>
      <span role="status" className="sm-copied">
        {copied ? 'Copied' : ''}
      </span>
      {manual != null && (
        <textarea ref={area} className="sm-copy-text" readOnly aria-label="Text to copy by hand" value={manual} rows={10} onFocus={(e) => e.currentTarget.select()} />
      )}
    </div>
  );
}
