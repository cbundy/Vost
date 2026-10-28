import { afterEach, describe, expect, it } from 'vitest';
import type { Candle } from '../../../shared/market.ts';
import { MAX_IN_FLIGHT, TICK_MS, useQuotes, type QuoteDocLike } from './quotes';

const bars: Candle[] = [
  { time: 1, open: 1, high: 1, low: 1, close: 10, volume: 1 },
  { time: 2, open: 1, high: 1, low: 1, close: 11, volume: 1 },
];

function setup(hidden = false) {
  const listeners = new Set<() => void>();
  const doc: QuoteDocLike & { hidden: boolean } = {
    hidden,
    addEventListener: (_t, fn) => void listeners.add(fn),
    removeEventListener: (_t, fn) => void listeners.delete(fn),
  };
  let time = 1_000_000;
  let tick: (() => void) | null = null;
  const calls: { key: string; signal: AbortSignal; resolve: (b: Candle[]) => void; reject: (e: unknown) => void }[] = [];
  const deps = {
    doc,
    now: () => time,
    hasProvider: (id: string) => id !== 'nope',
    setInterval: (fn: () => void) => ((tick = fn), 1),
    clearInterval: () => { tick = null; },
    fetchDaily: (id: string, symbol: string, _n: number, signal: AbortSignal) =>
      new Promise<Candle[]>((resolve, reject) => calls.push({ key: `${id}:${symbol}`, signal, resolve, reject })),
  };
  useQuotes.setState({ entries: {} });
  useQuotes.getState().start(deps);
  return {
    calls,
    advance(ms: number) { time += ms; tick?.(); },
    setHidden(h: boolean) { doc.hidden = h; listeners.forEach((f) => f()); },
  };
}
const want = (...syms: string[]) => syms.map((symbol) => ({ providerId: 'p', symbol, bars: 5 }));
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => useQuotes.getState().stop());

describe('quote store', () => {
  it('fetches a visible key once and not again within 60 s', async () => {
    const h = setup();
    useQuotes.getState().setWanted('rows', want('A'));
    expect(h.calls).toHaveLength(1);
    h.calls[0].resolve(bars);
    await flush();
    expect(useQuotes.getState().entries['p:A'].bars).toEqual(bars);
    h.advance(TICK_MS);
    useQuotes.getState().setWanted('rows', want('A'));
    expect(h.calls).toHaveLength(1);
    h.advance(60_000);
    expect(h.calls).toHaveLength(2);
  });

  it('keeps at most 4 in flight and continues as they finish', async () => {
    const h = setup();
    useQuotes.getState().setWanted('rows', want('A', 'B', 'C', 'D', 'E', 'F'));
    expect(h.calls).toHaveLength(MAX_IN_FLIGHT);
    h.calls[0].resolve(bars);
    await flush();
    expect(h.calls).toHaveLength(MAX_IN_FLIGHT + 1);
  });

  it('fetches nothing while hidden, aborts in-flight, and fetches on becoming visible', async () => {
    const h = setup();
    useQuotes.getState().setWanted('rows', want('A'));
    h.setHidden(true);
    expect(h.calls[0].signal.aborted).toBe(true);
    useQuotes.getState().setWanted('rows', want('A', 'B'));
    h.advance(TICK_MS);
    expect(h.calls).toHaveLength(1);
    h.setHidden(false);
    expect(h.calls).toHaveLength(3);
  });

  it('starts nothing when the tab is hidden at the start', () => {
    const h = setup(true);
    useQuotes.getState().setWanted('rows', want('A'));
    expect(h.calls).toHaveLength(0);
  });

  it('aborts a request when its row leaves the screen', () => {
    const h = setup();
    useQuotes.getState().setWanted('rows', want('A', 'B'));
    useQuotes.getState().setWanted('rows', want('B'));
    expect(h.calls[0].signal.aborted).toBe(true);
    expect(h.calls[1].signal.aborted).toBe(false);
  });

  it('does not fetch again within 60 s a key that left the screen and came back', () => {
    const h = setup();
    useQuotes.getState().setWanted('rows', want('A'));
    useQuotes.getState().setWanted('rows', []);
    useQuotes.getState().setWanted('rows', want('A'));
    expect(h.calls).toHaveLength(1);
    h.advance(60_000);
    expect(h.calls).toHaveLength(2);
  });

  it('stores a failure quietly and throttles it', async () => {
    const h = setup();
    useQuotes.getState().setWanted('rows', want('A'));
    h.calls[0].reject(new Error('boom'));
    await flush();
    expect(useQuotes.getState().entries['p:A'].bars).toBeNull();
    h.advance(TICK_MS);
    expect(h.calls).toHaveLength(1);
  });

  it('never fetches an unknown provider', () => {
    const h = setup();
    useQuotes.getState().setWanted('rows', [{ providerId: 'nope', symbol: 'A', bars: 5 }]);
    expect(h.calls).toHaveLength(0);
    expect(useQuotes.getState().entries['nope:A'].bars).toBeNull();
  });

  it('fetches again at once when a larger series is wanted', async () => {
    const h = setup();
    useQuotes.getState().setWanted('rows', want('A'));
    h.calls[0].resolve(bars);
    await flush();
    useQuotes.getState().setWanted('card', [{ providerId: 'p', symbol: 'A', bars: 260 }]);
    expect(h.calls).toHaveLength(2);
  });
});
