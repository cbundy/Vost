import { describe, expect, it } from 'vitest';
import { PROVIDER_CATALOG } from '../../shared/providerCatalog.ts';
import { BINANCE_INTERVALS, liveFeed, krakenWsSymbol, parseBinanceWs, parseBybitWs, parseKrakenWs, parseOkxWs } from './feeds.ts';

describe('liveFeed', () => {
  it('has a feed for exactly the providers the catalog marks live, for every timeframe they list', () => {
    for (const info of PROVIDER_CATALOG) {
      const result = liveFeed(info.id, info.defaultSymbol, info.defaultTimeframe);
      expect('feed' in result, info.id).toBe(info.supportsLive);
      if (info.supportsLive) {
        for (const tf of info.timeframes) expect('feed' in liveFeed(info.id, info.defaultSymbol, tf), `${info.id} ${tf}`).toBe(true);
      }
    }
  });
  it('binance intervals cover every binance timeframe', () => {
    const info = PROVIDER_CATALOG.find((p) => p.id === 'binance')!;
    for (const tf of info.timeframes) expect(BINANCE_INTERVALS[tf]).toBeTruthy();
  });
  it('builds the binance urls with a fallback host', () => {
    const r = liveFeed('binance', 'BTCUSDT', '1m');
    expect('feed' in r && r.feed.url).toBe('wss://stream.binance.com:9443/ws/btcusdt@kline_1m');
    expect('feed' in r && r.feed.fallbackUrl).toBe('wss://data-stream.binance.vision/ws/btcusdt@kline_1m');
  });
  it('subscribes and pings as each exchange wants', () => {
    const kraken = liveFeed('kraken', 'XBTUSD', '1h');
    expect('feed' in kraken && JSON.parse(kraken.feed.subscribe!)).toEqual({ method: 'subscribe', params: { channel: 'ohlc', symbol: ['BTC/USD'], interval: 60 } });
    expect('feed' in kraken && kraken.feed.pingMs).toBeUndefined();
    const bybit = liveFeed('bybit', 'BTCUSDT', '1d');
    expect('feed' in bybit && JSON.parse(bybit.feed.subscribe!)).toEqual({ op: 'subscribe', args: ['kline.D.BTCUSDT'] });
    expect('feed' in bybit && bybit.feed.pingMs).toBe(20000);
    const okx = liveFeed('okx', 'BTC-USDT', '4h');
    expect('feed' in okx && JSON.parse(okx.feed.subscribe!)).toEqual({ op: 'subscribe', args: [{ channel: 'candle4H', instId: 'BTC-USDT' }] });
    expect('feed' in okx && okx.feed.ping).toBe('ping');
  });
  it('words the errors the browser shows', () => {
    expect(liveFeed('binance', 'BTCUSDT', '1w')).toHaveProperty('feed');
    expect(liveFeed('binance', 'BTCUSDT', '7y')).toEqual({ error: 'Live data does not support 7y' });
    expect(liveFeed('kraken', 'XBTUSD', '1M')).toEqual({ error: 'Live data does not support 1M' });
    expect(liveFeed('nope', 'X', '1m')).toEqual({ error: 'Unknown provider "nope"' });
    expect(liveFeed('demo', 'X', '1m')).toHaveProperty('error');
  });
});

describe('Binance live', () => {
  it('parses a kline frame and ignores other frames', () => {
    const raw = JSON.stringify({ k: { t: 60000, o: '1', h: '2', l: '1', c: '2', v: '3', x: true } });
    expect(parseBinanceWs(raw)).toEqual([{ candle: { time: 60, open: 1, high: 2, low: 1, close: 2, volume: 3 }, closed: true }]);
    expect(parseBinanceWs('{"result":null,"id":1}')).toEqual([]);
  });
});

describe('Kraken live', () => {
  it('maps REST pair names to websocket symbols', () => {
    expect(krakenWsSymbol('XBTUSD')).toBe('BTC/USD');
    expect(krakenWsSymbol('ETHUSDT')).toBe('ETH/USDT');
    expect(krakenWsSymbol('XDGUSD')).toBe('XDG/USD');
  });
  it('parses a ws ohlc frame', () => {
    const raw = JSON.stringify({ channel: 'ohlc', type: 'update', data: [{ symbol: 'BTC/USD', open: 10, high: 12, low: 9, close: 11, volume: 3, interval_begin: '2023-11-14T22:00:00.000000Z', interval: 60 }] });
    expect(parseKrakenWs(raw)).toEqual([{ candle: { time: 1699999200, open: 10, high: 12, low: 9, close: 11, volume: 3 }, closed: false }]);
    expect(parseKrakenWs('{"channel":"heartbeat"}')).toEqual([]);
  });
});

describe('Bybit live', () => {
  it('parses a ws kline frame', () => {
    const raw = JSON.stringify({ topic: 'kline.60.BTCUSDT', data: [{ start: 3_600_000, open: '1', high: '3', low: '0.5', close: '2', volume: '9', confirm: true }] });
    expect(parseBybitWs(raw)).toEqual([{ candle: { time: 3600, open: 1, high: 3, low: 0.5, close: 2, volume: 9 }, closed: true }]);
    expect(parseBybitWs('{"op":"pong"}')).toEqual([]);
  });
});

describe('OKX live', () => {
  const row = (ms: number, confirm = '1') => [String(ms), '1', '3', '0.5', '2', '9', '0', '0', confirm];
  it('parses ws frames, confirm flag and pong', () => {
    const raw = JSON.stringify({ arg: { channel: 'candle1H', instId: 'BTC-USDT' }, data: [row(3_600_000, '0')] });
    expect(parseOkxWs(raw)).toEqual([{ candle: { time: 3600, open: 1, high: 3, low: 0.5, close: 2, volume: 9 }, closed: false }]);
    expect(parseOkxWs(JSON.stringify({ arg: { channel: 'candle1H' }, data: [row(0, '1')] }))[0].closed).toBe(true);
    expect(parseOkxWs('pong')).toEqual([]);
  });
});
