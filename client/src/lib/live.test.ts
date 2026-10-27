import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SLOW_RETRY_MS, startLiveApi } from './live';
import type { LiveStatus } from './providers/http';

type Listener = (ev: { data: string }) => void;

class FakeES {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeES[] = [];
  readyState = FakeES.CONNECTING;
  onerror: (() => void) | null = null;
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

function start() {
  const statuses: Array<[LiveStatus, string | undefined]> = [];
  const klines: Array<[number, boolean]> = [];
  const logs: Array<[string, string]> = [];
  const handle = startLiveApi('binance', {
    symbol: 'BTC/USDT',
    timeframe: '1m',
    onKline: (c, closed) => klines.push([c.time, closed]),
    onStatus: (s, d) => statuses.push([s, d]),
    onLog: (sev, text) => logs.push([sev, text]),
  });
  return { statuses, klines, logs, handle };
}

beforeEach(() => {
  FakeES.instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('EventSource', FakeES);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('startLiveApi', () => {
  it('opens one relative same-origin stream', () => {
    start();
    expect(FakeES.instances).toHaveLength(1);
    expect(last().url).toBe('/api/live?provider=binance&symbol=BTC%2FUSDT&timeframe=1m');
  });

  it('maps status, kline and log events to the callbacks', () => {
    const { statuses, klines, logs } = start();
    last().emit('status', { status: 'live' });
    last().emit('kline', { candle: { time: 60, open: 1, high: 2, low: 1, close: 2, volume: 3 }, closed: true });
    last().emit('log', { severity: 'warning', text: 'attempt 1' });
    last().emit('kline', 'not json');
    expect(statuses).toEqual([['live', undefined]]);
    expect(klines).toEqual([[60, true]]);
    expect(logs).toEqual([['warning', 'attempt 1']]);
  });

  it('maps a dropped connection to reconnecting, then back to live on the server status', () => {
    const { statuses } = start();
    last().emit('status', { status: 'live' });
    last().dropRetrying();
    expect(statuses[statuses.length - 1]).toEqual(['reconnecting', 'Connection to the Vost server lost']);
    expect(FakeES.instances).toHaveLength(1); // the browser reconnects by itself
    last().emit('status', { status: 'live' });
    expect(statuses[statuses.length - 1][0]).toBe('live');
  });

  it('a fatal status closes the stream and is never retried', () => {
    const { statuses } = start();
    last().emit('status', { status: 'error', detail: 'Live data does not support 1w', fatal: true });
    expect(statuses).toEqual([['error', 'Live data does not support 1w']]);
    expect(last().closed).toBe(true);
    last().dropFinal();
    vi.advanceTimersByTime(SLOW_RETRY_MS * 3);
    expect(FakeES.instances).toHaveLength(1);
  });

  it('reopens a closed stream after SLOW_RETRY_MS and reports error meanwhile', () => {
    const { statuses } = start();
    last().dropFinal();
    expect(statuses[statuses.length - 1]).toEqual(['error', 'Connection to the Vost server lost']);
    vi.advanceTimersByTime(SLOW_RETRY_MS - 1);
    expect(FakeES.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeES.instances).toHaveLength(2);
    last().emit('status', { status: 'live' });
    expect(statuses[statuses.length - 1][0]).toBe('live');
  });

  it('stop() closes the stream, reports off and cancels a pending reopen', () => {
    const { statuses, handle } = start();
    last().dropFinal();
    handle.stop();
    expect(statuses[statuses.length - 1]).toEqual(['off', undefined]);
    vi.advanceTimersByTime(SLOW_RETRY_MS * 2);
    expect(FakeES.instances).toHaveLength(1);
    expect(last().closed).toBe(true);
  });

  it('ignores events after stop()', () => {
    const { statuses, klines, handle } = start();
    const es = last();
    handle.stop();
    es.emit('status', { status: 'live' });
    es.emit('kline', { candle: { time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }, closed: false });
    es.dropRetrying();
    expect(statuses).toEqual([['off', undefined]]);
    expect(klines).toEqual([]);
  });
});
