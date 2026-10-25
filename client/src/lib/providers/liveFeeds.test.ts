import { describe, expect, it } from 'vitest';
import { PROVIDER_CATALOG } from '../../../../shared/providerCatalog.ts';
import { BINANCE_INTERVALS, LIVE_FEEDS, krakenWsSymbol, parseBybitWs, parseKrakenWs, parseOkxWs } from './liveFeeds';
import { providers } from './index';

describe('provider live contract', () => {
  it('supportsLive matches startLive for every provider, and the catalog', () => {
    for (const p of providers) {
      expect(Boolean(p.supportsLive), p.id).toBe(typeof p.startLive === 'function');
    }
    for (const info of PROVIDER_CATALOG) {
      expect(typeof providers.find((p) => p.id === info.id)?.startLive === 'function', info.id).toBe(info.supportsLive);
    }
  });
  it('has a live feed for exactly the providers the catalog marks live', () => {
    expect(Object.keys(LIVE_FEEDS).sort()).toEqual(PROVIDER_CATALOG.filter((p) => p.supportsLive).map((p) => p.id).sort());
  });
  it('binance intervals cover every binance timeframe', () => {
    const info = PROVIDER_CATALOG.find((p) => p.id === 'binance')!;
    for (const tf of info.timeframes) expect(BINANCE_INTERVALS[tf]).toBeTruthy();
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
