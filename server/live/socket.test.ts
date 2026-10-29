import { beforeEach, describe, expect, it } from 'vitest';
import type { LiveLogEvent, LiveStatusEvent } from '../../shared/market.ts';
import { liveFeed, type LiveFeed } from './feeds.ts';
import { MAX_ATTEMPTS, SLOW_RETRY_MS, SUBSCRIBE_RETRY_MS, openUpstream, backoffMs } from './socket.ts';
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

describe('feed onOpen hook', () => {
  type Ctx = Parameters<NonNullable<LiveFeed['onOpen']>>[0];
  function hooked() {
    const timers = fakeTimers();
    const opens: Array<{ ctx: Ctx; sent: number }> = [];
    const klines: number[] = [];
    const closed: number[] = [];
    const feed: LiveFeed = {
      url: 'wss://x',
      subscribe: 'sub',
      parse: () => [],
      onOpen: (ctx) => {
        opens.push({ ctx, sent: FakeWS.last.sent.length });
        const n = opens.length;
        ctx.onClose(() => closed.push(n));
      },
    };
    const sock = openUpstream({
      feed,
      WebSocket: FakeWebSocket,
      timers,
      label: 'x',
      onStatus: () => undefined,
      onKline: (c) => klines.push(c.time),
      onLog: () => undefined,
    });
    return { timers, opens, klines, closed, sock };
  }
  const item = (time: number) => [{ candle: { time, open: 1, high: 1, low: 1, close: 1, volume: 1 }, closed: false }];

  it('runs after subscribe on every open, and its emit reaches onKline', () => {
    const { timers, opens, klines } = hooked();
    FakeWS.last.open();
    expect(opens).toHaveLength(1);
    expect(opens[0].sent).toBe(1); // subscribe was already sent
    opens[0].ctx.emit(item(1));
    FakeWS.last.drop();
    timers.advance(15000);
    FakeWS.last.open();
    expect(opens).toHaveLength(2);
    opens[1].ctx.emit(item(2));
    expect(klines).toEqual([1, 2]);
  });

  it('kills emit and runs onClose when the connection drops or the socket is closed', () => {
    const { timers, opens, klines, closed, sock } = hooked();
    FakeWS.last.open();
    FakeWS.last.drop();
    expect(closed).toEqual([1]);
    opens[0].ctx.emit(item(1));
    timers.advance(15000);
    FakeWS.last.open();
    sock.close();
    expect(closed).toEqual([1, 2]);
    opens[1].ctx.emit(item(2));
    expect(klines).toEqual([]);
  });
});

describe('openUpstream with an async subscribe', () => {
  const asyncFeed = (subscribe: () => Promise<string>): LiveFeed => ({ url: 'wss://example.test/ws', subscribe, parse: () => [] });
  const start = (feed: LiveFeed) => {
    const timers = fakeTimers();
    const logs: LiveLogEvent[] = [];
    const sock = openUpstream({ feed, WebSocket: FakeWebSocket, timers, label: 'X 1h', onStatus: () => undefined, onKline: () => undefined, onLog: (e) => logs.push(e) });
    return { timers, logs, sock };
  };
  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  it('sends the resolved message after open, and again on reconnect', async () => {
    let n = 0;
    const { timers } = start(asyncFeed(async () => `sub-${++n}`));
    FakeWS.last.open();
    expect(FakeWS.last.sent).toEqual([]);
    await flush();
    expect(FakeWS.last.sent).toEqual(['sub-1']);
    FakeWS.last.drop();
    timers.advance(700);
    FakeWS.last.open();
    await flush();
    expect(FakeWS.last.sent).toEqual(['sub-2']);
  });

  it('does not send once the socket was replaced', async () => {
    let release: (m: string) => void = () => undefined;
    const { timers } = start(asyncFeed(() => new Promise<string>((r) => (release = r))));
    const first = FakeWS.last;
    first.open();
    first.drop();
    timers.advance(700);
    release('late');
    await flush();
    expect(first.sent).toEqual([]);
    expect(FakeWS.last.sent).toEqual([]);
  });

  it('logs a failed lookup and retries after 15 s while the socket stays open', async () => {
    let n = 0;
    const { timers, logs } = start(
      asyncFeed(async () => {
        if (++n === 1) throw new Error('market list unavailable');
        return 'sub';
      }),
    );
    const ws = FakeWS.last;
    ws.open();
    await flush();
    expect(ws.sent).toEqual([]);
    expect(logs.some((l) => l.severity === 'error' && l.text.includes('market list unavailable'))).toBe(true);
    timers.advance(SUBSCRIBE_RETRY_MS - 1);
    await flush();
    expect(ws.sent).toEqual([]);
    timers.advance(1);
    await flush();
    expect(ws.sent).toEqual(['sub']);
    expect(ws.closed).toBe(false);
  });
});
