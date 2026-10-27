import { beforeEach, describe, expect, it } from 'vitest';
import type { LiveKlineEvent, LiveLogEvent, LiveStatusEvent } from '../../shared/market.ts';
import { createRelay, type Subscriber } from './relay.ts';
import { FakeWS, FakeWebSocket, fakeTimers } from './testing.ts';

function sub() {
  const got = { status: [] as LiveStatusEvent[], kline: [] as LiveKlineEvent[], log: [] as LiveLogEvent[], ended: 0 };
  const s: Subscriber = {
    onStatus: (e) => got.status.push(e),
    onKline: (e) => got.kline.push(e),
    onLog: (e) => got.log.push(e),
    onEnd: () => got.ended++,
  };
  return { s, got };
}

const frame = (t: number, c = 2) => JSON.stringify({ k: { t, o: '1', h: '3', l: '1', c: String(c), v: '3', x: false } });

let timers: ReturnType<typeof fakeTimers>;
let lines: string[];
const make = () => createRelay({ WebSocket: FakeWebSocket, timers, log: (l) => lines.push(l) });

beforeEach(() => {
  FakeWS.reset();
  timers = fakeTimers();
  lines = [];
});

describe('relay', () => {
  it('shares one upstream socket between subscribers of the same feed', () => {
    const relay = make();
    const a = sub();
    const b = sub();
    relay.subscribe('binance', 'BTCUSDT', '1m', a.s);
    relay.subscribe('binance', ' btcusdt ', '1m', b.s);
    expect(FakeWS.instances).toHaveLength(1);
    FakeWS.last.open();
    FakeWS.last.message(frame(60000));
    expect(a.got.kline).toHaveLength(1);
    expect(b.got.kline).toHaveLength(1);
  });

  it('gives a new subscriber the current status and the last kline at once', () => {
    const relay = make();
    relay.subscribe('binance', 'BTCUSDT', '1m', sub().s);
    FakeWS.last.open();
    FakeWS.last.message(frame(60000, 5));
    const late = sub();
    relay.subscribe('binance', 'BTCUSDT', '1m', late.s);
    expect(late.got.status).toEqual([{ status: 'live' }]);
    expect(late.got.kline).toEqual([{ candle: { time: 60, open: 1, high: 3, low: 1, close: 5, volume: 3 }, closed: false }]);
  });

  it('the first subscriber sees connecting', () => {
    const a = sub();
    make().subscribe('binance', 'BTCUSDT', '1m', a.s);
    expect(a.got.status).toEqual([{ status: 'connecting' }]);
  });

  it('opens a second socket for another symbol or timeframe', () => {
    const relay = make();
    relay.subscribe('binance', 'BTCUSDT', '1m', sub().s);
    relay.subscribe('binance', 'ETHUSDT', '1m', sub().s);
    relay.subscribe('binance', 'BTCUSDT', '5m', sub().s);
    expect(FakeWS.instances).toHaveLength(3);
  });

  it('closes the socket and its timers when the last subscriber leaves', () => {
    const relay = make();
    const a = relay.subscribe('bybit', 'BTCUSDT', '1m', sub().s);
    const b = relay.subscribe('bybit', 'BTCUSDT', '1m', sub().s);
    FakeWS.last.open();
    expect(timers.pending).toBe(1); // the ping interval
    if ('error' in a || 'error' in b) throw new Error('subscribe failed');
    a.unsubscribe();
    expect(FakeWS.last.closed).toBe(false);
    b.unsubscribe();
    b.unsubscribe(); // idempotent
    expect(FakeWS.last.closed).toBe(true);
    expect(timers.pending).toBe(0);
    expect(relay.stats()).toEqual([]);
    // a later subscriber starts a fresh socket
    relay.subscribe('bybit', 'BTCUSDT', '1m', sub().s);
    expect(FakeWS.instances).toHaveLength(2);
  });

  it('clears a pending retry timer when the last subscriber leaves during backoff', () => {
    const relay = make();
    const r = relay.subscribe('binance', 'BTCUSDT', '1m', sub().s);
    FakeWS.last.drop();
    expect(timers.pending).toBe(1);
    if ('error' in r) throw new Error('subscribe failed');
    r.unsubscribe();
    expect(timers.pending).toBe(0);
  });

  it('refuses what it cannot serve', () => {
    const relay = make();
    const a = sub();
    expect(relay.subscribe('binance', 'BTCUSDT', '9x', a.s)).toEqual({ error: 'Live data does not support 9x' });
    expect(relay.subscribe('nope', 'BTCUSDT', '1m', a.s)).toEqual({ error: 'Unknown provider "nope"' });
    expect(relay.subscribe('coinbase', 'BTCUSDT', '1m', a.s)).toHaveProperty('error');
    expect(relay.subscribe('binance', '  ', '1m', a.s)).toEqual({ error: 'Missing symbol' });
    expect(FakeWS.instances).toHaveLength(0);
    expect(relay.stats()).toEqual([]);
  });

  it('logs every failure to the server and the subscribers, and keeps counts for the status endpoint', () => {
    const relay = make();
    const a = sub();
    relay.subscribe('binance', 'BTCUSDT', '1m', a.s);
    FakeWS.last.drop(1006, 'gone');
    expect(lines[0]).toMatch(/^\[live\] binance BTCUSDT 1m warning: Live connection to wss:\/\/stream\.binance\.com:9443\/ws\/btcusdt@kline_1m failed \(attempt 1\): close code 1006, reason "gone"/);
    expect(a.got.log[0].text).toContain('attempt 1');
    expect(relay.stats()).toEqual([
      { provider: 'binance', symbol: 'BTCUSDT', timeframe: '1m', subscribers: 1, status: 'reconnecting', reconnects: 1, lastError: expect.stringContaining('close code 1006') },
    ]);
  });

  it('closeAll() closes every socket, ends every subscriber and leaves no timers', () => {
    const relay = make();
    const a = sub();
    const b = sub();
    relay.subscribe('bybit', 'BTCUSDT', '1m', a.s);
    relay.subscribe('okx', 'BTC-USDT', '1m', b.s);
    FakeWS.instances[0].open();
    FakeWS.instances[1].drop();
    relay.closeAll();
    expect(FakeWS.instances[0].closed).toBe(true); // the other one was already closed by its peer
    expect(a.got.ended).toBe(1);
    expect(b.got.ended).toBe(1);
    expect(timers.pending).toBe(0);
    expect(relay.stats()).toEqual([]);
  });

  it('one throwing subscriber does not stop the others', () => {
    const relay = make();
    relay.subscribe('binance', 'BTCUSDT', '1m', {
      onStatus: () => undefined,
      onKline: () => {
        throw new Error('broken pipe');
      },
      onLog: () => undefined,
      onEnd: () => undefined,
    });
    const b = sub();
    relay.subscribe('binance', 'BTCUSDT', '1m', b.s);
    FakeWS.last.open();
    FakeWS.last.message(frame(60000));
    expect(b.got.kline).toHaveLength(1);
  });
});
