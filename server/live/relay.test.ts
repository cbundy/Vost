import { beforeEach, describe, expect, it } from 'vitest';
import type { LiveKlineEvent, LiveLogEvent, LiveStatusEvent } from '../../shared/market.ts';
import { PROVIDER_CATALOG } from '../../shared/providerCatalog.ts';
import type { Candle } from '../../shared/market.ts';
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
    expect(relay.subscribe('yahoo', 'AAPL', '1m', a.s)).toHaveProperty('error');
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

describe('relay: built timeframes', () => {
  const DAY = 86400;
  const JAN1 = Date.UTC(2024, 0, 1) / 1000;
  const FEB1 = Date.UTC(2024, 1, 1) / 1000;
  const krakenFrame = (time: number, o: number, h: number, l: number, c: number, v: number) =>
    JSON.stringify({ channel: 'ohlc', data: [{ interval_begin: new Date(time * 1000).toISOString(), open: o, high: h, low: l, close: c, volume: v }] });
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  let rows: Candle[];
  let asked: number;
  const makeBuilt = () =>
    createRelay({
      WebSocket: FakeWebSocket,
      timers,
      log: (l) => lines.push(l),
      now: () => (FEB1 - DAY + 3600) * 1000,
      history: async () => {
        asked++;
        return rows;
      },
    });
  beforeEach(() => {
    rows = [{ time: JAN1, open: 1, high: 2, low: 1, close: 2, volume: 10 }];
    asked = 0;
  });

  it('shares the base socket and streams the whole higher bar', async () => {
    const relay = makeBuilt();
    const base = sub();
    const built = sub();
    relay.subscribe('kraken', 'XBTUSD', '1d', base.s);
    relay.subscribe('kraken', 'XBTUSD', '1M', built.s);
    expect(FakeWS.instances).toHaveLength(1);
    FakeWS.last.open();
    expect(built.got.status.at(-1)).toEqual({ status: 'live' });
    await flush();
    expect(asked).toBe(1);
    FakeWS.last.message(krakenFrame(FEB1 - DAY, 2, 5, 2, 4, 5));
    expect(base.got.kline).toHaveLength(1);
    expect(built.got.kline.at(-1)).toEqual({ candle: { time: JAN1, open: 1, high: 5, low: 1, close: 4, volume: 15 }, closed: false });
    FakeWS.last.message(krakenFrame(FEB1, 4, 4, 3, 3, 1));
    expect(built.got.kline.filter((k) => k.closed)).toHaveLength(1);
  });

  it('gives a second built subscriber the status and last built kline at once', async () => {
    const relay = makeBuilt();
    relay.subscribe('kraken', 'XBTUSD', '1M', sub().s);
    FakeWS.last.open();
    await flush();
    const late = sub();
    relay.subscribe('kraken', 'XBTUSD', '1M', late.s);
    expect(late.got.status).toEqual([{ status: 'live' }]);
    expect(late.got.kline).toHaveLength(1);
    expect(late.got.kline[0].candle.time).toBe(JAN1);
    expect(asked).toBe(1);
    expect(FakeWS.instances).toHaveLength(1);
  });

  it('keeps the socket while a base or built subscriber stays, closes it when both leave', () => {
    const relay = makeBuilt();
    const a = relay.subscribe('kraken', 'XBTUSD', '1d', sub().s);
    const b = relay.subscribe('kraken', 'XBTUSD', '1M', sub().s);
    if ('error' in a || 'error' in b) throw new Error('subscribe failed');
    b.unsubscribe();
    expect(FakeWS.last.closed).toBe(false);
    const c = relay.subscribe('kraken', 'XBTUSD', '1M', sub().s);
    if ('error' in c) throw new Error('subscribe failed');
    a.unsubscribe();
    expect(FakeWS.last.closed).toBe(false);
    c.unsubscribe();
    expect(FakeWS.last.closed).toBe(true);
    expect(relay.stats()).toEqual([]);
  });

  it('stats lists the upstream entry only, the built one counted as a subscriber', () => {
    const relay = makeBuilt();
    relay.subscribe('kraken', 'XBTUSD', '1d', sub().s);
    relay.subscribe('kraken', 'XBTUSD', '1M', sub().s);
    relay.subscribe('kraken', 'XBTUSD', '1M', sub().s);
    expect(relay.stats().map((e) => [e.timeframe, e.subscribers])).toEqual([['1d', 2]]);
  });

  it('closeAll ends built subscribers and closes the socket', () => {
    const relay = makeBuilt();
    const built = sub();
    relay.subscribe('kraken', 'XBTUSD', '1M', built.s);
    relay.closeAll();
    expect(built.got.ended).toBe(1);
    expect(FakeWS.last.closed).toBe(true);
    expect(relay.stats()).toEqual([]);
  });

  it('forwards base status and log events unchanged', () => {
    const relay = makeBuilt();
    const built = sub();
    relay.subscribe('kraken', 'XBTUSD', '1M', built.s);
    FakeWS.last.open();
    FakeWS.last.drop();
    expect(built.got.status.map((s) => s.status)).toEqual(['connecting', 'live', 'reconnecting']);
    expect(built.got.log.length).toBeGreaterThan(0);
  });

  it('every built timeframe of every live provider subscribes', () => {
    const relay = makeBuilt();
    let n = 0;
    for (const p of PROVIDER_CATALOG.filter((x) => x.supportsLive)) {
      for (const tf of p.builtTimeframes) {
        const r = relay.subscribe(p.id, 'BTCUSD', tf, sub().s);
        expect(r, `${p.id} ${tf}`).not.toHaveProperty('error');
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
    relay.closeAll();
  });

  it('refuses a built timeframe without a history dep, and one that is neither native nor built', () => {
    expect(make().subscribe('kraken', 'XBTUSD', '1M', sub().s)).toEqual({ error: 'Live data does not support 1M' });
    expect(makeBuilt().subscribe('kraken', 'XBTUSD', '9x', sub().s)).toEqual({ error: 'Live data does not support 9x' });
  });
});

describe('relay: custom intervals', () => {
  const H = 3600;
  const T0 = Date.UTC(2024, 0, 1) / 1000; // a multiple of 2h
  const flush = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  const makeIv = () => createRelay({ WebSocket: FakeWebSocket, timers, log: (l) => lines.push(l), now: () => (T0 + 3600) * 1000, history: async () => [] });

  it('streams a Binance 2h bar on the 1h socket and closes it once when the next bucket begins', async () => {
    const relay = makeIv();
    const a = sub();
    relay.subscribe('binance', 'BTCUSDT', '2h', a.s);
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.last.url).toContain('1h');
    FakeWS.last.open();
    await flush();
    FakeWS.last.message(frame((T0 + H) * 1000));
    expect(a.got.kline.at(-1)).toMatchObject({ candle: { time: T0 }, closed: false });
    FakeWS.last.message(frame((T0 + 2 * H) * 1000));
    expect(a.got.kline.filter((k) => k.closed)).toHaveLength(1);
    FakeWS.last.message(frame((T0 + 3 * H) * 1000));
    expect(a.got.kline.filter((k) => k.closed)).toHaveLength(1);
  });

  it('shares the entry between two 2h subscribers', async () => {
    const relay = makeIv();
    relay.subscribe('binance', 'BTCUSDT', '2h', sub().s);
    FakeWS.last.open();
    await flush();
    FakeWS.last.message(frame((T0 + H) * 1000));
    const late = sub();
    relay.subscribe('binance', 'BTCUSDT', '2h', late.s);
    expect(FakeWS.instances).toHaveLength(1);
    expect(late.got.kline).toHaveLength(1);
  });

  it('refuses a non-canonical, a malformed and a non-nesting interval with no socket opened', () => {
    const relay = makeIv();
    expect(relay.subscribe('binance', 'BTCUSDT', '120m', sub().s)).toEqual({ error: 'Live data does not support 120m' });
    expect(relay.subscribe('binance', 'BTCUSDT', '2x', sub().s)).toEqual({ error: 'Live data does not support 2x' });
    const info = PROVIDER_CATALOG.find((p) => p.id === 'coinbase')!;
    const saved = info.timeframes;
    info.timeframes = ['1h', '1d']; // no 1m: 7m nests in nothing
    try {
      expect(relay.subscribe('coinbase', 'BTC-USD', '7m', sub().s)).toEqual({ error: 'Live data does not support 7m' });
    } finally {
      info.timeframes = saved;
    }
    expect(FakeWS.instances).toHaveLength(0);
  });
});

describe('relay: built source', () => {
  const makeSrc = () => createRelay({ WebSocket: FakeWebSocket, timers, log: (l) => lines.push(l), history: async () => [] });

  it('keeps a native and a built Binance 4h apart; the built one rides the 1h socket', () => {
    const relay = makeSrc();
    const native = sub();
    const built = sub();
    const hour = sub();
    relay.subscribe('binance', 'BTCUSDT', '4h', native.s);
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.instances[0].url).toContain('4h');
    relay.subscribe('binance', 'BTCUSDT', '1h', hour.s);
    relay.subscribe('binance', 'BTCUSDT', '4h', built.s, { source: 'built' });
    expect(FakeWS.instances).toHaveLength(2); // 4h native, 1h shared by the 1h chart and the built 4h
    expect(FakeWS.instances.filter((w) => w.url.includes('1h'))).toHaveLength(1);
    expect(relay.stats().map((s) => s.timeframe).sort()).toEqual(['1h', '4h']);
  });

  it('releases the built entry and its base socket when its last subscriber leaves', () => {
    const relay = makeSrc();
    const res = relay.subscribe('binance', 'BTCUSDT', '4h', sub().s, { source: 'built' });
    expect('unsubscribe' in res).toBe(true);
    expect(relay.stats().map((s) => s.timeframe)).toEqual(['1h']);
    if ('unsubscribe' in res) res.unsubscribe();
    expect(relay.stats()).toEqual([]);
  });

  it('the lowest timeframe stays native with source=built', () => {
    const relay = makeSrc();
    relay.subscribe('binance', 'BTCUSDT', '1m', sub().s, { source: 'built' });
    expect(relay.stats().map((s) => s.timeframe)).toEqual(['1m']);
  });
});
