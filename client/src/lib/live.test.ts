import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SLOW_RETRY_MS, createLiveMux, startLiveApi, type LiveMux } from './live';
import type { LiveStatus } from './providers/http';

type Listener = (ev: { data: string }) => void;

class FakeES {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeES[] = [];
  readyState = FakeES.CONNECTING;
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  closed = false;
  listeners = new Map<string, Listener>();
  constructor(public url: string) {
    FakeES.instances.push(this);
  }
  addEventListener(name: string, fn: Listener) {
    this.listeners.set(name, fn);
  }
  close() {
    this.closed = true;
    this.readyState = FakeES.CLOSED;
  }
  // test helpers
  emit(name: string, data: unknown) {
    this.listeners.get(name)?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }
  /** The connection is established. */
  open() {
    this.readyState = FakeES.OPEN;
    this.onopen?.();
  }
  /** The network dropped while the browser keeps reconnecting by itself. */
  dropRetrying() {
    this.readyState = FakeES.CONNECTING;
    this.onerror?.();
  }
  /** The browser gave up. */
  dropFinal() {
    this.readyState = FakeES.CLOSED;
    this.onerror?.();
  }
}
const last = () => FakeES.instances[FakeES.instances.length - 1];

let mux: LiveMux;
const flush = () => Promise.resolve();
const candle = (time: number) => ({ time, open: 1, high: 2, low: 1, close: 2, volume: 3 });

interface Rec {
  statuses: Array<[LiveStatus, string | undefined]>;
  klines: Array<[number, boolean]>;
  logs: Array<[string, string]>;
  handle: { stop(): void };
}

function start(symbol = 'BTC/USDT', timeframe = '1m', source?: 'built'): Rec {
  const r: Rec = { statuses: [], klines: [], logs: [], handle: { stop() {} } };
  r.handle = mux.subscribe('binance', {
    symbol,
    timeframe,
    source,
    onKline: (c, closed) => r.klines.push([c.time, closed]),
    onStatus: (s, d) => r.statuses.push([s, d]),
    onLog: (sev, text) => r.logs.push([sev, text]),
  });
  return r;
}

const key = (symbol: string, tf = '1m', source = 'native') => `binance:${tf}:${source}:${symbol}`;
const subs = (es: FakeES) => new URL(es.url, 'http://x').searchParams.getAll('sub');
const lastStatus = (r: Rec) => r.statuses[r.statuses.length - 1];

beforeEach(() => {
  FakeES.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeES);
  mux = createLiveMux();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('startLiveApi', () => {
  it('keeps its signature and returns a stoppable handle on the shared stream', async () => {
    const handle = startLiveApi('binance', { symbol: 'ZZZ', timeframe: '1m', onKline: () => undefined, onStatus: () => undefined });
    await flush();
    expect(last().url).toBe(`/api/live?sub=${encodeURIComponent('binance:1m:native:ZZZ')}`);
    handle.stop();
    await flush();
    expect(last().closed).toBe(true);
  });
});

describe('live mux', () => {
  it('opens one relative same-origin stream with the sub form', async () => {
    start();
    await flush();
    expect(FakeES.instances).toHaveLength(1);
    expect(last().url).toBe('/api/live?sub=binance%3A1m%3Anative%3ABTC%2FUSDT');
  });

  it('puts source=built in the key only when set', async () => {
    start('BTCUSDT', '4h', 'built');
    await flush();
    expect(subs(last())).toEqual(['binance:4h:built:BTCUSDT']);
  });

  it('three subscribes in one tick open one stream with three sub params, routed by sub', async () => {
    const a = start('AAA');
    const b = start('BBB');
    const c = start('CCC');
    await flush();
    expect(FakeES.instances).toHaveLength(1);
    expect(subs(last())).toEqual([key('AAA'), key('BBB'), key('CCC')]);
    last().emit('kline', { candle: candle(60), closed: true, sub: key('BBB') });
    last().emit('status', { status: 'live', sub: key('AAA') });
    last().emit('log', { severity: 'warning', text: 'x', sub: key('CCC') });
    expect(a.klines).toEqual([]);
    expect(b.klines).toEqual([[60, true]]);
    expect(c.klines).toEqual([]);
    expect(a.statuses).toEqual([['live', undefined]]);
    expect(b.statuses).toEqual([]);
    expect(c.logs).toEqual([['warning', 'x']]);
    expect(a.logs).toEqual([]);
  });

  it('two subscribers on one market share a key and both get its events', async () => {
    const a = start('AAA');
    const b = start('AAA');
    await flush();
    expect(subs(last())).toEqual([key('AAA')]);
    last().emit('kline', { candle: candle(60), closed: false, sub: key('AAA') });
    expect(a.klines).toEqual([[60, false]]);
    expect(b.klines).toEqual([[60, false]]);
    a.handle.stop();
    await flush();
    expect(FakeES.instances).toHaveLength(1); // the key stays, nothing to change
    last().emit('kline', { candle: candle(120), closed: false, sub: key('AAA') });
    expect(b.klines).toHaveLength(2);
    expect(a.klines).toHaveLength(1);
  });

  it('maps a dropped connection to reconnecting, then back to live on the server status', async () => {
    const a = start('AAA');
    const b = start('BBB');
    await flush();
    last().open();
    last().emit('status', { status: 'live', sub: key('AAA') });
    last().dropRetrying();
    expect(lastStatus(a)).toEqual(['reconnecting', 'Connection to the Vost server lost']);
    expect(lastStatus(b)).toEqual(['reconnecting', 'Connection to the Vost server lost']);
    expect(FakeES.instances).toHaveLength(1); // the browser reconnects by itself
    last().emit('status', { status: 'live', sub: key('AAA') });
    expect(lastStatus(a)![0]).toBe('live');
  });

  it('reopens a closed stream once after SLOW_RETRY_MS and reports error to every subscriber', async () => {
    const a = start('AAA');
    const b = start('BBB');
    await flush();
    last().dropFinal();
    expect(lastStatus(a)).toEqual(['error', 'Connection to the Vost server lost']);
    expect(lastStatus(b)).toEqual(['error', 'Connection to the Vost server lost']);
    vi.advanceTimersByTime(SLOW_RETRY_MS - 1);
    await flush();
    expect(FakeES.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    await flush();
    expect(FakeES.instances).toHaveLength(2);
    expect(subs(last())).toEqual([key('AAA'), key('BBB')]);
    last().emit('status', { status: 'live', sub: key('BBB') });
    expect(lastStatus(b)![0]).toBe('live');
  });

  it('opens the new stream first and closes the old one only when the new one opens', async () => {
    const a = start('AAA');
    const b = start('BBB');
    const c = start('CCC');
    await flush();
    const old = last();
    old.open();
    old.emit('status', { status: 'live', sub: key('AAA') });
    const before = a.statuses.length;
    c.handle.stop();
    await flush();
    expect(FakeES.instances).toHaveLength(2);
    const next = last();
    expect(subs(next)).toEqual([key('AAA'), key('BBB')]);
    expect(old.closed).toBe(false);
    // while both are open, either stream feeds the remaining subscribers
    old.emit('kline', { candle: candle(60), closed: false, sub: key('AAA') });
    next.emit('kline', { candle: candle(60), closed: false, sub: key('AAA') });
    expect(a.klines).toEqual([[60, false], [60, false]]);
    next.open();
    expect(old.closed).toBe(true);
    expect(next.closed).toBe(false);
    next.emit('kline', { candle: candle(120), closed: false, sub: key('BBB') });
    expect(b.klines).toEqual([[120, false]]);
    for (const r of [a, b]) {
      expect(r.statuses.some(([s]) => s === 'reconnecting' || s === 'error')).toBe(false);
    }
    expect(a.statuses).toHaveLength(before);
  });

  it('a new chart joining gets its status from the new stream while the others stay quiet', async () => {
    const a = start('AAA');
    await flush();
    last().open();
    last().emit('status', { status: 'live', sub: key('AAA') });
    const b = start('BBB');
    await flush();
    const next = last();
    next.emit('status', { status: 'connecting', sub: key('AAA') });
    next.emit('status', { status: 'connecting', sub: key('BBB') });
    expect(a.statuses).toEqual([['live', undefined]]);
    expect(b.statuses).toEqual([['connecting', undefined]]);
  });

  it('the last stop() closes the stream and opens nothing', async () => {
    const a = start('AAA');
    const b = start('BBB');
    await flush();
    const es = last();
    a.handle.stop();
    b.handle.stop();
    await flush();
    expect(FakeES.instances).toHaveLength(1);
    expect(es.closed).toBe(true);
    expect(lastStatus(a)).toEqual(['off', undefined]);
  });

  it('a tagged fatal status reaches only its key, is never retried and is left out of the next stream', async () => {
    const a = start('AAA');
    const b = start('BBB');
    await flush();
    const es = last();
    es.emit('status', { status: 'error', detail: 'Live data does not support 1w', fatal: true, sub: key('AAA') });
    expect(a.statuses).toEqual([['error', 'Live data does not support 1w']]);
    expect(b.statuses).toEqual([]);
    expect(es.closed).toBe(false);
    es.emit('kline', { candle: candle(60), closed: false, sub: key('AAA') });
    es.emit('kline', { candle: candle(60), closed: false, sub: key('BBB') });
    expect(a.klines).toEqual([]);
    expect(b.klines).toHaveLength(1);
    es.dropRetrying();
    expect(a.statuses).toHaveLength(1);
    const c = start('CCC');
    await flush();
    expect(subs(last())).toEqual([key('BBB'), key('CCC')]);
    expect(c.statuses).toEqual([]);
  });

  it('closes the stream only when every remaining key is fatal', async () => {
    start('AAA');
    start('BBB');
    await flush();
    const es = last();
    es.emit('status', { status: 'error', detail: 'no', fatal: true, sub: key('AAA') });
    await flush();
    expect(es.closed).toBe(false);
    es.emit('status', { status: 'error', detail: 'no', fatal: true, sub: key('BBB') });
    await flush();
    expect(es.closed).toBe(true);
    vi.advanceTimersByTime(SLOW_RETRY_MS * 3);
    await flush();
    expect(FakeES.instances).toHaveLength(1);
  });

  it('ignores a malformed event', async () => {
    const a = start('AAA');
    await flush();
    last().emit('kline', 'not json');
    expect(a.klines).toEqual([]);
  });

  it('stop() reports off to that subscriber only and its later events are ignored', async () => {
    const a = start('AAA');
    const b = start('AAA');
    const c = start('BBB');
    await flush();
    const es = last();
    a.handle.stop();
    es.emit('status', { status: 'live', sub: key('AAA') });
    es.emit('kline', { candle: candle(60), closed: false, sub: key('AAA') });
    es.dropRetrying();
    expect(a.statuses).toEqual([['off', undefined]]);
    expect(a.klines).toEqual([]);
    expect(b.statuses[0]).toEqual(['live', undefined]);
    expect(c.statuses.some(([s]) => s === 'off')).toBe(false);
    expect(es.closed).toBe(false);
  });

  it('stop() cancels a pending reopen', async () => {
    const a = start('AAA');
    await flush();
    last().dropFinal();
    a.handle.stop();
    await flush();
    vi.advanceTimersByTime(SLOW_RETRY_MS * 2);
    await flush();
    expect(FakeES.instances).toHaveLength(1);
  });
});
