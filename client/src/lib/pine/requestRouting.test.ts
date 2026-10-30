import { Indicator } from 'pinets';
import { describe, expect, it } from 'vitest';
import { version as pinetsVersion } from '../../../../node_modules/pinets/package.json';
import { candles15, fakeServer, hourlyOf } from './securityFixture';
import { createMarketProvider } from './market';
import { runPine } from './runtime';
import {
  PROVIDER_IDS, RoutedPineTS, RoutingError, UNAVAILABLE_REQUESTS, assertHooked, decodeRoute, encodeRoute, installRouting, rewriteSymbolArg, routeSymbol,
} from './requestRouting';
import type { PineMarket } from './types';

const binance: PineMarket = { providerId: 'binance', symbol: 'BTCUSDT', interval: '1h' };
const dataset: PineMarket = { providerId: 'csv', symbol: 'DATA', barSeconds: 3600, dataset: true };

describe('route ids', () => {
  it('round trip, and are colon-free', () => {
    const id = encodeRoute({ providerId: 'hyperliquid-perps', symbol: 'BTC' });
    expect(id).not.toContain(':');
    expect(decodeRoute(id)).toEqual({ providerId: 'hyperliquid-perps', symbol: 'BTC' });
  });
  it('are not found in ordinary tickers or unknown providers', () => {
    for (const t of ['BTCUSDT', 'binance:BTCUSDT', 'foo~BTC', '~BTC', 'binance~', 5, undefined]) expect(decodeRoute(t)).toBeNull();
  });
});

describe('routeSymbol', () => {
  it('leaves "", the chart id and the bare ticker as they are', () => {
    for (const s of ['', 'BTCUSDT', 'btcusdt', 'BINANCE:BTCUSDT', 'binance:btcusdt']) expect(routeSymbol(s, binance)).toBe(s);
  });
  it('leaves everything when there is no market (the run has no other data)', () => {
    expect(routeSymbol('BYBIT:ETHUSDT', undefined)).toBe('BYBIT:ETHUSDT');
  });
  it('routes a bare other symbol to the chart provider and a prefix to its provider, in lower case', () => {
    expect(routeSymbol('ETHUSDT', binance)).toBe('binance~ETHUSDT');
    expect(routeSymbol('BYBIT:BTCUSDT', binance)).toBe('bybit~BTCUSDT');
    expect(routeSymbol('Hyperliquid-Perps:BTC', binance)).toBe('hyperliquid-perps~BTC');
    expect(routeSymbol('={"session":"extended","symbol":"OKX:BTC-USDT"}', binance)).toBe('okx~BTC-USDT');
  });
  it('an unknown prefix names it and lists the provider ids', () => {
    expect(() => routeSymbol('FOO:BTC', binance)).toThrow(RoutingError);
    try { routeSymbol('FOO:BTC', binance); } catch (e) {
      expect((e as Error).message).toContain('"FOO"');
      for (const id of PROVIDER_IDS) expect((e as Error).message).toContain(id);
    }
  });
  it('a dataset chart needs a prefix; its own full id is its own data', () => {
    expect(routeSymbol('CSV:DATA', dataset)).toBe('CSV:DATA');
    expect(routeSymbol('DATA', dataset)).toBe('DATA');
    expect(() => routeSymbol('BTCUSDT', dataset)).toThrow(/dataset chart can only read a symbol with a provider prefix/);
    expect(routeSymbol('BYBIT:BTCUSDT', dataset)).toBe('bybit~BTCUSDT');
  });
});

describe('rewriteSymbolArg', () => {
  const up = (s: string) => `<${s}>`;
  const series = (v: unknown) => ({ get: () => v });
  it('rewrites a string, a Series, a request.param tuple and the named symbol key, and nothing else', () => {
    expect(rewriteSymbolArg(['A', 'D', 7], up)).toEqual(['<A>', 'D', 7]);
    expect(rewriteSymbolArg([series('A'), 'D'], up)[0]).toBe('<A>');
    expect(rewriteSymbolArg([['A', 'p1'], 'D'], up)[0]).toEqual(['<A>', 'p1']);
    expect(rewriteSymbolArg([{ symbol: ['A', 'p1'], timeframe: 'D' }], up)).toEqual([{ symbol: ['<A>', 'p1'], timeframe: 'D' }]);
    expect(rewriteSymbolArg(['A', 'D', 'x', { lookahead: 'on' }], up)).toEqual(['<A>', 'D', 'x', { lookahead: 'on' }]);
    const na = series(NaN);
    expect(rewriteSymbolArg([na], up)[0]).toBe(na);
  });
});

describe('the hook into the Pine engine (pinned to PineTS 0.13.0)', () => {
  it('runs against the engine version the routing was written for', () => {
    expect(pinetsVersion).toBe('0.13.0');
  });

  it('is called on a run and finds security, security_lower_tf and currency_rate on context.pine.request', async () => {
    const candles = hourlyOf(candles15(96));
    const { provider, ticker, timeframe, endTime } = createMarketProvider(candles, binance, fakeServer(candles15(96)).feed);
    const pine = new RoutedPineTS(provider, ticker, timeframe, undefined, undefined, endTime);
    expect(pine.hooked).toBe(0);
    expect(() => assertHooked(pine)).toThrow(/never installed/);
    await pine.run(new Indicator('//@version=6\nindicator("x")\nplot(close)'));
    expect(pine.hooked).toBeGreaterThan(0);
    expect(() => assertHooked(pine)).not.toThrow();
  });

  it('fails with a clear message when a request function is missing from the context', () => {
    for (const name of ['security', 'security_lower_tf', 'currency_rate', ...Object.keys(UNAVAILABLE_REQUESTS)]) {
      const request: Record<string, unknown> = { security() {}, security_lower_tf() {}, currency_rate() {} };
      for (const k of Object.keys(UNAVAILABLE_REQUESTS)) request[k] = () => {};
      delete request[name];
      expect(() => installRouting({ pine: { request } }, { market: binance, rates: null })).toThrow(new RegExp(`request.${name}.*pinned to PineTS 0.13.0`));
    }
    expect(() => installRouting({}, { market: binance, rates: null })).toThrow(/pinned to PineTS/);
  });
});

describe('the request calls Vost has no data for', () => {
  const chart = hourlyOf(candles15(96 * 3));
  const run = (src: string) => runPine('//@version=6\nindicator("x")\n' + src, chart, {}, { market: binance, feed: fakeServer(candles15(96 * 3)).feed });
  const calls: Record<string, [string, string]> = {
    financial: ['request.financial("NASDAQ:AAPL", "TOTAL_REVENUE", "FY")', 'it has no company financials data'],
    economic: ['request.economic("US", "GDP")', 'it has no economic data'],
    seed: ['request.seed("seed_x", "SYM", close)', 'it has no Pine Seeds data'],
    dividends: ['request.dividends("NASDAQ:AAPL", dividends.net)', 'it has no dividend data'],
    splits: ['request.splits("NASDAQ:AAPL", splits.denominator)', 'it has no split data'],
    earnings: ['request.earnings("NASDAQ:AAPL", earnings.actual)', 'it has no earnings data'],
  };
  for (const [name, [call, why]] of Object.entries(calls)) {
    it(`request.${name} stops the run`, async () => {
      const r = await run(`plot(${call})`);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.message).toBe(`request.${name}() is not available in Vost: ${why}`);
    });
  }
  it('stops from an if block that runs on one bar', async () => {
    const r = await run('if bar_index == 70\n    plot(request.earnings("NASDAQ:AAPL", earnings.actual))\nplot(close)');
    expect(r.ok).toBe(false);
  });
  it('still runs a script that only declares an unused function with the call', async () => {
    const r = await run('f() => request.splits("NASDAQ:AAPL", splits.denominator)\nplot(close)');
    expect(r.ok).toBe(true);
  });
});
