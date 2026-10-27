import { beforeEach, describe, expect, it } from 'vitest';
import type { LiveLogEvent, LiveStatusEvent } from '../../shared/market.ts';
import { liveFeed, type LiveFeed } from './feeds.ts';
import { MAX_ATTEMPTS, SLOW_RETRY_MS, openUpstream, backoffMs } from './socket.ts';
import { FakeWS, FakeWebSocket, fakeTimers } from './testing.ts';

const feedOf = (provider: string, symbol: string, tf: string): LiveFeed => {
  const r = liveFeed(provider, symbol, tf);
  if ('error' in r) throw new Error(r.error);
  return r.feed;
};

function setup(provider = 'binance', symbol = 'BTCUSDT', tf = '1m') {
  const timers = fakeTimers();
  const statuses: LiveStatusEvent[] = [];
  const logs: LiveLogEvent[] = [];
  const klines: Array<[number, boolean]> = [];
  const failures: string[] = [];
  const sock = openUpstream({
    feed: feedOf(provider, symbol, tf),
    WebSocket: FakeWebSocket,
    timers,
    label: `${symbol} ${tf}`,
    onStatus: (e) => statuses.push(e),
    onKline: (c, closed) => klines.push([c.time, closed]),
    onLog: (e) => logs.push(e),
    onFailure: (t) => failures.push(t),
  });
  return { timers, statuses, logs, klines, failures, sock };
}

beforeEach(() => FakeWS.reset());

describe('openUpstream', () => {
  it('reports connecting, then live on open', () => {
    const { statuses } = setup();
    FakeWS.last.open();
    expect(statuses.map((s) => s.status)).toEqual(['connecting', 'live']);
  });

  it('retries with 700 ms doubling backoff capped at 15 s', () => {
    const { timers } = setup();
    const delays: number[] = [];
    for (let i = 0; i < MAX_ATTEMPTS - 1; i++) {
      FakeWS.last.drop();
      delays.push(timers.delays()[0]);
      timers.advance(timers.delays()[0]);
    }
    expect(delays).toEqual([700, 1400, 2800, 5600, 11200, 15000, 15000]);
    expect(backoffMs(1)).toBe(700);
  });

  it('switches binance to data-stream.binance.vision on the 4th connect', () => {
    const { timers, logs } = setup();
    for (let i = 0; i < 3; i++) {
      FakeWS.last.drop();
      timers.advance(15000);
    }
    expect(FakeWS.instances.map((w) => new URL(w.url.replace(/^ws/, 'http')).host)).toEqual([
      'stream.binance.com:9443',
      'stream.binance.com:9443',
      'stream.binance.com:9443',
      'data-stream.binance.vision',
    ]);
    expect(logs.some((l) => l.text.includes('Switching to the fallback stream host data-stream.binance.vision'))).toBe(true);
  });

  it('after 8 failures reports error with a log naming url, attempt and close code, then retries slowly', () => {
    const { timers, statuses, logs, failures } = setup();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      FakeWS.last.drop(1006, '');
      if (i < MAX_ATTEMPTS - 1) timers.advance(15000);
    }
    expect(statuses[statuses.length - 1]).toEqual({ status: 'error', detail: 'Live connection lost - see the inbox for details' });
    const text = logs.map((l) => l.text).join('\n');
    expect(text).toContain('failed (attempt 1): close code 1006');
    expect(text).toContain('Giving up on live data for BTCUSDT 1m after 8 attempts');
    expect(text).toContain('data-stream.binance.vision');
    expect(failures).toHaveLength(8);
    expect(timers.delays()).toEqual([SLOW_RETRY_MS]);
    const before = FakeWS.instances.length;
    timers.advance(SLOW_RETRY_MS - 1);
    expect(FakeWS.instances.length).toBe(before);
    timers.advance(1);
    expect(FakeWS.instances.length).toBe(before + 1);
    expect(statuses[statuses.length - 1].status).toBe('reconnecting');
    // a slow retry that fails again goes straight back to the slow timer
    FakeWS.last.drop();
    expect(statuses[statuses.length - 1].status).toBe('error');
    expect(timers.delays()).toEqual([SLOW_RETRY_MS]);
  });

  it('a successful open after the slow retry resets the attempts', () => {
    const { timers, statuses } = setup();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      FakeWS.last.drop();
      if (i < MAX_ATTEMPTS - 1) timers.advance(15000);
    }
    timers.advance(SLOW_RETRY_MS);
    FakeWS.last.open();
    expect(statuses[statuses.length - 1].status).toBe('live');
    FakeWS.last.drop();
    expect(timers.delays()).toEqual([700]);
  });

  it('a constructor that throws counts as a failed attempt', () => {
    const timers = fakeTimers();
    const statuses: string[] = [];
    const logs: string[] = [];
    openUpstream({
      feed: feedOf('binance', 'BTCUSDT', '1m'),
      WebSocket: class {
        constructor() {
          throw new Error('boom');
        }
      } as never,
      timers,
      label: 'x',
      onStatus: (e) => statuses.push(e.status),
      onKline: () => undefined,
      onLog: (e) => logs.push(e.text),
    });
    expect(logs[0]).toContain('boom');
    expect(timers.delays()).toEqual([700]);
  });

  it('sends the subscribe message on every open', () => {
    const { timers } = setup('kraken', 'XBTUSD', '1h');
    FakeWS.last.open();
    expect(FakeWS.last.sent).toHaveLength(1);
    FakeWS.last.drop();
    timers.advance(700);
    FakeWS.last.open();
    expect(FakeWS.last.sent).toHaveLength(1);
  });

  it.each([
    ['bybit', 'BTCUSDT', '{"op":"ping"}'],
    ['okx', 'BTC-USDT', 'ping'],
  ])('%s pings every 20 s while open and stops on close', (provider, symbol, ping) => {
    const { timers } = setup(provider, symbol, '1m');
    const ws = FakeWS.last;
    ws.open();
    expect(ws.sent).toHaveLength(1); // subscribe
    timers.advance(19999);
    expect(ws.sent).toHaveLength(1);
    timers.advance(1);
    expect(ws.sent[1]).toBe(ping);
    timers.advance(20000);
    expect(ws.sent).toHaveLength(3);
    ws.drop();
    expect(timers.delays()).toEqual([700]); // only the retry is left: the ping interval is gone
  });

  it('kraken keeps no ping', () => {
    const { timers } = setup('kraken', 'XBTUSD', '1h');
    FakeWS.last.open();
    expect(timers.pending).toBe(0);
  });

  it('delivers klines and ignores malformed frames', () => {
    const { klines } = setup();
    FakeWS.last.open();
    FakeWS.last.message('not json');
    FakeWS.last.message('{"k":{"t":60000,"o":"1","h":"2","l":"1","c":"2","v":"3","x":false}}');
    expect(klines).toEqual([[60, false]]);
  });

  it('close() closes the socket and clears every timer, and a late close event is ignored', () => {
    const { timers, sock, statuses } = setup('bybit', 'BTCUSDT', '1m');
    const ws = FakeWS.last;
    ws.open();
    const n = statuses.length;
    sock.close();
    expect(ws.closed).toBe(true);
    expect(timers.pending).toBe(0);
    ws.drop();
    expect(timers.pending).toBe(0);
    expect(statuses).toHaveLength(n);
  });

  it('close() during backoff cancels the retry', () => {
    const { timers, sock } = setup();
    FakeWS.last.drop();
    expect(timers.pending).toBe(1);
    sock.close();
    expect(timers.pending).toBe(0);
  });
});
