import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEARTBEAT_MS } from '../server/live/route.ts';
import { SWEEP_MS } from '../server/candles/recorder.ts';
import { DEFAULT_POLL_SECONDS } from '../server/alerts/evaluator.ts';
import { SYMBOL_CACHE_MS } from '../server/providers/symbolCache.ts';
import { QUOTE_MIN_AGE_MS } from '../client/src/lib/quotes.ts';

// client/src/state/quotes.ts pulls in the browser provider registry, so its TICK_MS is read from source.
const TICK_MS = Number(/export const TICK_MS = ([\d_]+);/.exec(readFileSync('client/src/state/quotes.ts', 'utf8'))?.[1].replace(/_/g, ''));

const guide = readFileSync('docs/guide/data.md', 'utf8');
const start = guide.indexOf('## How often data updates');
const section = guide.slice(start, guide.indexOf('\n## ', start + 1));

describe('guide: How often data updates', () => {
  it('has the section', () => expect(start).toBeGreaterThan(-1));
  it.each([
    ['HEARTBEAT_MS', `${HEARTBEAT_MS / 1000} s`],
    ['TICK_MS', `${TICK_MS / 1000} s`],
    ['QUOTE_MIN_AGE_MS', `${QUOTE_MIN_AGE_MS / 1000} s`],
    ['SWEEP_MS', `${SWEEP_MS / 60_000} minutes`],
    ['DEFAULT_POLL_SECONDS', `(${DEFAULT_POLL_SECONDS} by default)`],
    ['SYMBOL_CACHE_MS', `${SYMBOL_CACHE_MS / 3_600_000} hours`],
  ])('states %s as "%s"', (_name, text) => {
    expect(section).toContain(text);
  });
});
