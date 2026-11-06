import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { runAnyBacktest } from '../lib/backtest/runner';
import type { BacktestConfig } from '../lib/backtest/types';
import { synth } from '../strategyMaker/engine/synthetic';
import type { SweepInput } from '../strategyMaker/sweep/types';
import { attachBridge, type FromEngine, type ToEngine } from './bridge';

const candles = synth(400, 5);
const config: BacktestConfig = {
  strategyId: 'sma_cross',
  params: { fast: 5, slow: 20, direction: 1 },
  initialCapital: 10000,
  positionSizePct: 100,
  feeBps: 0,
  slippageBps: 0,
  allowShort: false,
  stopLossPct: null,
  takeProfitPct: null,
};

/** The parent end of a channel whose other end is the bridge; `answer` plays the server. */
function parent(answer: (ask: Extract<FromEngine, { proto: 'ask' }>) => unknown) {
  const { port1, port2 } = new MessageChannel();
  attachBridge(port2);
  const got: FromEngine[] = [];
  const asks: FromEngine[] = [];
  const waiters: Array<(m: FromEngine) => void> = [];
  port1.on('message', (m: FromEngine) => {
    if (m.proto === 'ask') {
      asks.push(m);
      Promise.resolve()
        .then(() => answer(m))
        .then(
          (value) => port1.postMessage({ proto: 'answer', rid: m.rid, ok: true, value } satisfies ToEngine),
          (e: Error) => port1.postMessage({ proto: 'answer', rid: m.rid, ok: false, error: e.message } satisfies ToEngine),
        );
      return;
    }
    got.push(m);
    for (const w of waiters.splice(0)) w(m);
  });
  const next = (until: (m: FromEngine) => boolean): Promise<FromEngine> =>
    new Promise((resolve) => {
      const hit = got.find(until);
      if (hit) return resolve(hit);
      const w = (m: FromEngine) => (until(m) ? resolve(m) : waiters.push(w));
      waiters.push(w);
    });
  return { send: (m: ToEngine) => port1.postMessage(m), next, asks, close: () => (port1.close(), port2.close()) };
}

describe('server engine bridge', () => {
  it('a backtest run equals a direct runAnyBacktest', async () => {
    const p = parent(() => null);
    p.send({ proto: 'backtest', msg: { id: 'r', type: 'run', candles, config } });
    const done = await p.next((m) => m.proto === 'backtest' && m.msg.type === 'result');
    if (done.proto !== 'backtest' || done.msg.type !== 'result') throw new Error('no result');
    expect(done.msg.result).toEqual(await runAnyBacktest(candles, config));
    p.close();
  });

  it('a strategy maker sweep asks the parent for its candles and finishes when it answers', async () => {
    const input: SweepInput = {
      markets: [{ provider: 'test', symbol: 'AAA' }],
      timeframes: ['1d'],
      families: ['sma_cross'],
      direction: 'long',
      targetSets: [{ minHitRatePct: 0 }],
      risk: { initialCapital: 1000, riskPct: 2, feeBps: 10, slippageBps: 5 },
      exits: { stopMults: [1], tpMults: [1] },
      space: { sma_cross: [{ key: 'fast', from: 8, to: 8, step: 1 }, { key: 'slow', from: 34, to: 34, step: 1 }] },
    };
    const data = synth(1500, 3);
    const p = parent((ask) => {
      if (ask.kind !== 'history') throw new Error('unexpected');
      expect(ask.provider).toBe('test');
      expect(ask.req.symbol).toBe('AAA');
      return data;
    });
    p.send({ proto: 'maker', msg: { v: 1, id: 's', type: 'sweep', input } });
    const done = await p.next((m) => m.proto === 'maker' && (m.msg.type === 'sweep-result' || m.msg.type === 'error'));
    expect(p.asks).toHaveLength(1);
    expect(done.proto === 'maker' && done.msg.type).toBe('sweep-result');
    p.close();
  });

  it('a failed candle load is a skipped series, not a hang', async () => {
    const input = {
      markets: [{ provider: 'test', symbol: 'GONE' }],
      timeframes: ['1d'],
      families: ['sma_cross'],
      direction: 'long',
      targetSets: [{ minHitRatePct: 0 }],
      risk: { initialCapital: 1000, riskPct: 2, feeBps: 10, slippageBps: 5 },
      exits: { stopMults: [1], tpMults: [1] },
      space: {},
    } as SweepInput;
    const p = parent(() => {
      throw new Error('no such market');
    });
    p.send({ proto: 'maker', msg: { v: 1, id: 's', type: 'sweep', input } });
    const done = await p.next((m) => m.proto === 'maker' && (m.msg.type === 'sweep-result' || m.msg.type === 'error'));
    if (done.proto !== 'maker' || done.msg.type !== 'sweep-result') throw new Error('expected a result');
    expect(done.msg.result.skipped.length).toBe(1);
    p.close();
  });

  it('a strategy maker cancel gives the cancelled error', async () => {
    const p = parent(() => new Promise(() => undefined));
    p.send({ proto: 'maker', msg: { v: 1, id: 'c', type: 'cancel' } });
    const done = await p.next((m) => m.proto === 'maker');
    expect(done).toEqual({ proto: 'maker', msg: { v: 1, id: 'c', type: 'error', message: 'Cancelled', cancelled: true } });
    p.close();
  });

  it('a Pine library lookup goes to the parent and its answer reaches runPine; a miss gives the library outcome', async () => {
    const script = '//@version=6\nindicator("uses lib")\nimport bob/Inner/1 as inner\nplot(inner.double(close))\n';
    const lib = '//@version=6\nlibrary("Inner")\nexport double(float x) => x * 2\n';
    const p = parent((ask) => (ask.kind === 'library' && ask.path === 'bob/Inner/1' ? lib : null));
    p.send({ proto: 'backtest', msg: { id: 'p1', type: 'pine', source: script, candles } });
    const hit = await p.next((m) => m.proto === 'backtest' && m.msg.id === 'p1');
    expect(p.asks.some((a) => a.proto === 'ask' && a.kind === 'library' && a.path === 'bob/Inner/1')).toBe(true);
    expect(hit.proto === 'backtest' && hit.msg.type === 'pineResult' && hit.msg.outcome.ok).toBe(true);
    p.close();

    const q = parent(() => null);
    q.send({ proto: 'backtest', msg: { id: 'p2', type: 'pine', source: script, candles } });
    const miss = await q.next((m) => m.proto === 'backtest' && m.msg.id === 'p2');
    if (miss.proto !== 'backtest' || miss.msg.type !== 'pineResult' || miss.msg.outcome.ok) throw new Error('expected a library miss');
    expect(miss.msg.outcome.error.library).toBe('bob/Inner/1');
    q.close();
  });

  it('a failed parent lookup is an error in the worker, not a hang', async () => {
    const script = '//@version=6\nindicator("uses lib")\nimport bob/Inner/1 as inner\nplot(inner.double(close))\n';
    const p = parent(() => {
      throw new Error('server down');
    });
    p.send({ proto: 'backtest', msg: { id: 'p3', type: 'pine', source: script, candles } });
    const done = await p.next((m) => m.proto === 'backtest' && m.msg.id === 'p3');
    if (done.proto !== 'backtest') throw new Error('x');
    expect(done.msg.type === 'pineResult' ? done.msg.outcome.ok : false).toBe(false);
    p.close();
  });
});
