import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Candle } from '../../shared/market.ts';
import { NotFoundError } from '../providers/errors.ts';
import type { HistoryRequest } from '../providers/types.ts';
import { readThroughHistory } from './history.ts';
import { openCandleStore, type CandleStore, type Series } from './store.ts';

const H = 3600;
const NOW = 1_000_000 * H + 600; // mid-bar: the forming bar is at 1_000_000 * H
const FORMING = 1_000_000 * H;
const GAP = 999_990 * H; // the exchange has no candle here
const candle = (time: number): Candle => ({ time, open: 1, high: 2, low: 0.5, close: time % 97, volume: 3 });
const EXCHANGE: Candle[] = [];
for (let t = FORMING - 100 * H; t <= FORMING; t += H) if (t !== GAP) EXCHANGE.push(candle(t));
const S: Series = { provider: 'Fake', symbol: 'BTC', timeframe: '1h' };

/** A fake exchange honouring span and bars-ending-at-`to` requests, and recording each call. */
function fakeExchange() {
  const calls: HistoryRequest[] = [];
  const fetch = async (req: HistoryRequest): Promise<Candle[]> => {
    calls.push(req);
    const upTo = EXCHANGE.filter((c) => c.time <= (req.to ?? NOW));
    const out = req.from !== undefined ? upTo.filter((c) => c.time >= req.from!) : upTo.slice(-req.bars);
    if (out.length === 0 && req.from !== undefined) throw new NotFoundError(`Fake has no BTC 1h data from ${req.from} to ${req.to}`);
    return out;
  };
  return { calls, fetch };
}

let dir: string;
let store: CandleStore;
const logs: string[] = [];
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'vost-hist-'));
  logs.length = 0;
  store = await openCandleStore({ dir, now: () => NOW * 1000, log: (l) => logs.push(l) });
});
afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

const deps = (ex: ReturnType<typeof fakeExchange>, over: Partial<Parameters<typeof readThroughHistory>[0]> = {}) => ({
  store,
  isRecorded: () => true,
  fetch: ex.fetch,
  now: () => NOW * 1000,
  log: (l: string) => logs.push(l),
  ...over,
});
const span = (from: number, to: number): HistoryRequest => ({ symbol: 'BTC', timeframe: '1h', bars: 1000, from, to });
const direct = (req: HistoryRequest) => fakeExchange().fetch(req);

describe('span mode', () => {
  it('fetches only the forming bar when the closed part is covered', async () => {
    const from = FORMING - 50 * H;
    const first = fakeExchange();
    await readThroughHistory(deps(first), 'Fake', span(from, NOW));
    const ex = fakeExchange();
    const out = await readThroughHistory(deps(ex), 'Fake', span(from, NOW));
    expect(out).toEqual(await direct(span(from, NOW)));
    expect(ex.calls).toHaveLength(1);
    expect(ex.calls[0]).toMatchObject({ from: NOW - H + 1, to: NOW });
    expect(store.range(S, FORMING, FORMING)).toEqual([]); // forming bar never stored
  });

  it('fetches only the hole and answers exactly as the exchange would', async () => {
    const lo = FORMING - 60 * H;
    const hi = FORMING - 2 * H;
    store.upsert(S, EXCHANGE.filter((c) => c.time >= lo && c.time <= lo + 9 * H), lo, lo + 9 * H);
    store.upsert(S, EXCHANGE.filter((c) => c.time >= lo + 30 * H && c.time <= hi), lo + 30 * H, hi);
    const ex = fakeExchange();
    const out = await readThroughHistory(deps(ex), 'Fake', span(lo, hi));
    expect(out).toEqual(await direct(span(lo, hi)));
    expect(ex.calls).toHaveLength(1);
    expect(ex.calls[0]).toMatchObject({ from: lo + 9 * H + 1, to: lo + 30 * H - 1 });
    expect(new Set(out.map((c) => c.time)).size).toBe(out.length);
    expect(out.some((c) => c.time === GAP)).toBe(false);
    // the hole is now covered: a repeat fetches nothing
    const again = fakeExchange();
    await readThroughHistory(deps(again), 'Fake', span(lo, hi));
    expect(again.calls).toEqual([]);
    expect(logs.some((l) => l.startsWith('[candles] Fake BTC 1h span'))).toBe(true);
  });

  it('gives the exchange 404 for an empty span', async () => {
    const ex = fakeExchange();
    const req = span(GAP, GAP);
    await expect(readThroughHistory(deps(ex), 'Fake', req)).rejects.toThrow(/Fake has no BTC 1h data from/);
    await expect(direct(req)).rejects.toThrow(NotFoundError);
  });
});

describe('bars mode', () => {
  const barsReq = (bars: number, to?: number): HistoryRequest => ({ symbol: 'BTC', timeframe: '1h', bars, ...(to === undefined ? {} : { to }) });

  it('fetches once without coverage, writes back, then serves from disk', async () => {
    const to = FORMING - 5 * H;
    const ex = fakeExchange();
    const out = await readThroughHistory(deps(ex), 'Fake', barsReq(20, to));
    expect(out).toEqual(await direct(barsReq(20, to)));
    expect(ex.calls).toHaveLength(1);
    const again = fakeExchange();
    expect(await readThroughHistory(deps(again), 'Fake', barsReq(20, to))).toEqual(out);
    expect(again.calls).toEqual([]);
  });

  it('serves the closed part from disk and fetches only the forming bar', async () => {
    await readThroughHistory(deps(fakeExchange()), 'Fake', barsReq(30));
    const ex = fakeExchange();
    const out = await readThroughHistory(deps(ex), 'Fake', barsReq(30));
    expect(out).toEqual(await direct(barsReq(30)));
    expect(ex.calls).toHaveLength(1);
    expect(ex.calls[0]).toMatchObject({ from: NOW - H + 1 });
    expect(logs.some((l) => l.includes('forming'))).toBe(true);
  });

  it('a short store makes one exchange call, not a forming fetch and a whole one', async () => {
    await readThroughHistory(deps(fakeExchange()), 'Fake', barsReq(10));
    const ex = fakeExchange();
    await readThroughHistory(deps(ex), 'Fake', barsReq(40));
    expect(ex.calls).toHaveLength(1);
  });

  it('refetches when coverage is too short or broken', async () => {
    await readThroughHistory(deps(fakeExchange()), 'Fake', barsReq(10, FORMING - H));
    const ex = fakeExchange();
    const out = await readThroughHistory(deps(ex), 'Fake', barsReq(40, FORMING - H));
    expect(out).toEqual(await direct(barsReq(40, FORMING - H)));
    expect(ex.calls).toHaveLength(1);
  });
});

describe('fallbacks', () => {
  it('a series that is not recorded fetches and writes nothing', async () => {
    const ex = fakeExchange();
    const out = await readThroughHistory(deps(ex, { isRecorded: () => false }), 'Fake', span(FORMING - 5 * H, NOW));
    expect(out).toEqual(await direct(span(FORMING - 5 * H, NOW)));
    expect(ex.calls).toHaveLength(1);
    expect(store.stats().rows).toBe(0);
  });

  it('with no isRecorded nothing is recorded', async () => {
    const ex = fakeExchange();
    await readThroughHistory(deps(ex, { isRecorded: undefined }), 'Fake', span(FORMING - 5 * H, NOW));
    expect(store.stats().rows).toBe(0);
  });

  it('a store that is off calls the adapter exactly as today', async () => {
    const blocker = await mkdtemp(path.join(tmpdir(), 'vost-hist-off-'));
    try {
      await writeFile(path.join(blocker, 'f'), 'x');
      const off = await openCandleStore({ dir: path.join(blocker, 'f', 'd'), log: () => undefined });
      expect(off.on).toBe(false);
      const ex = fakeExchange();
      const req = span(FORMING - 5 * H, NOW);
      const out = await readThroughHistory(deps(ex, { store: off }), 'Fake', req);
      expect(ex.calls).toEqual([req]);
      expect(out).toEqual(await direct(req));
    } finally {
      await rm(blocker, { recursive: true, force: true });
    }
  });

  it('a store write that throws still answers, logging once', async () => {
    const broken = new Proxy(store, {
      get: (t, k) => (k === 'upsert' ? () => { throw new Error('disk full'); } : (t as any)[k]),
    });
    const req = span(FORMING - 5 * H, NOW);
    const ex = fakeExchange();
    const out = await readThroughHistory(deps(ex, { store: broken }), 'Fake', req);
    await readThroughHistory(deps(ex, { store: broken }), 'Fake', req);
    expect(out).toEqual(await direct(req));
    expect(logs.filter((l) => l.includes('store write failed'))).toHaveLength(1);
  });

  it('a store read that throws falls back to the exchange', async () => {
    const broken = new Proxy(store, {
      get: (t, k) => (k === 'range' ? () => { throw new Error('io'); } : (t as any)[k]),
    });
    const req = span(FORMING - 5 * H, NOW);
    const out = await readThroughHistory(deps(fakeExchange(), { store: broken }), 'Fake', req);
    expect(out).toEqual(await direct(req));
    expect(logs.some((l) => l.includes('store read failed'))).toBe(true);
  });
});
