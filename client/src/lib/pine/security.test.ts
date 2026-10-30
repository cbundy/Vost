import { describe, expect, it } from 'vitest';
import { buildBars } from '../../../../shared/timeframes';
import { ema, sma } from '../indicators';
import type { Candle } from '../../types';
import { runPine } from './runtime';
import { START, candles15, fakeServer, hourlyOf } from './securityFixture';
import type { PineMarket } from './types';

const market: PineMarket = { providerId: 'binance', symbol: 'BTCUSDT', interval: '1h' };
const head = '//@version=6\nindicator("s")\n';

async function values(src: string, candles: Candle[], feed: ReturnType<typeof fakeServer>['feed'], m: PineMarket = market) {
  const r = await runPine(head + src, candles, {}, { market: m, feed });
  if (!r.ok) throw new Error(r.error.message);
  return r.plots[0].values;
}

const base = candles15(96 * 60);
const chart = hourlyOf(base);

describe('request.security on the chart symbol at another timeframe', () => {
  it('daily EMA equals a hand calculation over finished daily bars', async () => {
    const got = await values('plot(request.security(syminfo.tickerid, "D", ta.ema(close, 10)))', chart, fakeServer(base).feed);
    const e = ema(buildBars(chart, '1d').map((b) => b.close), 10);
    const want = chart.map((_, i) => {
      const day = Math.floor(i / 24);
      return e[i % 24 === 23 ? day : day - 1] ?? null;
    });
    expect(got).toHaveLength(want.length);
    got.forEach((g, i) => {
      if (want[i] === null) expect(g).toBeNull();
      else expect(g).toBeCloseTo(want[i]!, 9);
    });
    expect(want.filter((w) => w !== null).length).toBeGreaterThan(1000);
  });

  it('12 hour SMA equals a hand calculation, and the bare ticker form works too', async () => {
    const got = await values('plot(request.security("BTCUSDT", "720", ta.sma(close, 4)))', chart, fakeServer(base).feed);
    const s = sma(buildBars(chart, '12h').map((b) => b.close), 4);
    chart.forEach((_, i) => {
      const k = Math.floor(i / 12);
      const w = s[i % 12 === 11 ? k : k - 1] ?? null;
      if (w === null) expect(got[i]).toBeNull();
      else expect(got[i]).toBeCloseTo(w, 9);
    });
  });

  it('a 15 minute request gives the last 15 minute bar of each hour', async () => {
    const got = await values('plot(request.security(syminfo.tickerid, "15", open))', chart, fakeServer(base).feed);
    chart.forEach((_, i) => expect(got[i]).toBe(base[4 * i + 3].open));
  });

  it('lookahead_on shows the day from its first bar, and with close[1] equals lookahead_off', async () => {
    const feed = fakeServer(base).feed;
    const on = await values('plot(request.security(syminfo.tickerid, "D", close, lookahead = barmerge.lookahead_on))', chart, feed);
    const days = buildBars(chart, '1d');
    chart.forEach((_, i) => expect(on[i]).toBe(days[Math.floor(i / 24)].close));
    const onPrev = await values('plot(request.security(syminfo.tickerid, "D", close[1], lookahead = barmerge.lookahead_on))', chart, feed);
    const off = await values('plot(request.security(syminfo.tickerid, "D", close))', chart, feed);
    // Same on every bar but a day's last one, where lookahead_off already has the day's close and close[1] still the day before's.
    chart.forEach((_, i) => { if (i % 24 !== 23) expect(onPrev[i]).toEqual(off[i]); });
    expect(off[23]).toBe(days[0].close);
    expect(onPrev[23]).toBeNull();
  });

  it('the forming day never shows the final close the server already has', async () => {
    const cut = chart.slice(0, 24 * 40 + 5);
    const feed = fakeServer(base, { finalClose: 99999 }).feed;
    const off = await values('plot(request.security(syminfo.tickerid, "D", close))', cut, feed);
    const on = await values('plot(request.security(syminfo.tickerid, "D", close, lookahead = barmerge.lookahead_on))', cut, feed);
    expect([...off, ...on].some((v) => v === 99999)).toBe(false);
    expect(on.at(-1)).toBe(cut.at(-1)!.close);
    const day40 = cut.slice(24 * 40);
    // the forming day's high so far is the high of its own candles, not the server's
    const hi = await values('plot(request.security(syminfo.tickerid, "D", high, lookahead = barmerge.lookahead_on))', cut, feed);
    expect(hi.at(-1)).toBe(Math.max(...day40.map((c) => c.high)));
  });

  it('cutting later candles never changes earlier values (also a window of the data)', async () => {
    const src = 'plot(request.security(syminfo.tickerid, "D", ta.sma(close, 3)))';
    const feed = fakeServer(base).feed;
    const full = await values(src, chart, feed);
    for (const cutAt of [24 * 20 + 7, 24 * 33, 24 * 50 + 23]) {
      const cut = await values(src, chart.slice(0, cutAt), feed);
      expect(cut).toEqual(full.slice(0, cutAt));
    }
    const win = await values(src, chart.slice(200, 900), feed);
    expect(win).toEqual(full.slice(200, 900));
  });

  it('a session market gets the daily value on the last session bar of the day', async () => {
    // New York hours: 7 hourly bars a weekday opening 13:30 UTC, the last one at 19:30.
    const days = Array.from({ length: 30 }, (_, d) => START + d * 86400).filter((t) => new Date(t * 1000).getUTCDay() % 6 !== 0);
    const sess: Candle[] = days.flatMap((t, d) => Array.from({ length: 7 }, (_, h) => {
      const close = 100 + d * 10 + h;
      return { time: t + 13.5 * 3600 + h * 3600, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1 };
    }));
    const daily: Candle[] = days.map((t, d) => ({ time: t + 13.5 * 3600, open: 99.5 + d * 10, high: 107 + d * 10, low: 99 + d * 10, close: 106 + d * 10, volume: 7 }));
    const feed = { bars: async (r: { fromMs: number; toMs: number }) => daily.filter((c) => c.time * 1000 >= r.fromMs && (c.time + 86400) * 1000 <= r.toMs + 1) };
    const got = await values('plot(request.security(syminfo.tickerid, "D", close))', sess, feed);
    sess.forEach((c, i) => {
      const d = Math.floor(i / 7);
      // The newest day has not ended at the run's end, so it is the forming bar and shows on no bar of the run.
      const lastBar = i % 7 === 6 && d < days.length - 1;
      const want = lastBar ? daily[d].close : d > 0 ? daily[d - 1].close : null;
      if (want === null) expect(got[i]).toBeNull(); else expect(got[i]).toBe(want);
    });
  });

  it('a session market still gets the daily value on a Monday, the day after a weekend', async () => {
    const days = Array.from({ length: 29 }, (_, d) => START + d * 86400).filter((t) => new Date(t * 1000).getUTCDay() % 6 !== 0);
    const sess: Candle[] = days.flatMap((t, d) => Array.from({ length: 7 }, (_, h) => {
      const close = 100 + d * 10 + h;
      return { time: t + 13.5 * 3600 + h * 3600, open: close - 0.5, high: close + 1, low: close - 1, close, volume: 1 };
    }));
    const daily: Candle[] = days.map((t, d) => ({ time: t + 13.5 * 3600, open: 99.5 + d * 10, high: 107 + d * 10, low: 99 + d * 10, close: 106 + d * 10, volume: 7 }));
    const feed = { bars: async (r: { fromMs: number; toMs: number }) => daily.filter((c) => c.time * 1000 >= r.fromMs && (c.time + 86400) * 1000 <= r.toMs + 1) };
    const cut = sess.slice(0, sess.length - 5); // Monday Jan 29, two bars
    expect(new Date(cut[cut.length - 1].time * 1000).getUTCDay()).toBe(1);
    const fridayClose = daily[daily.length - 2].close;
    const off = await values('plot(request.security(syminfo.tickerid, "D", close))', cut, feed);
    expect(off.slice(-2)).toEqual([fridayClose, fridayClose]);
    const on = await values('plot(request.security(syminfo.tickerid, "D", close, lookahead = barmerge.lookahead_on))', cut, feed);
    // lookahead_on sees the whole day's bar on each of its bars: the last value is the last hourly close.
    const last = cut[cut.length - 1].close;
    expect(on.slice(-2)).toEqual([last, last]);
  });

  it('an imported dataset builds higher bars from its own candles and cannot give lower ones', async () => {
    const ds: PineMarket = { providerId: 'csv', symbol: 'DATA', barSeconds: 3600, dataset: true };
    const feed = { bars: async () => { throw new Error('a dataset has no provider'); } };
    const got = await values('plot(request.security(syminfo.tickerid, "D", close))', chart, feed, ds);
    const days = buildBars(chart, '1d');
    chart.forEach((_, i) => {
      const day = Math.floor(i / 24);
      const w = i % 24 === 23 ? days[day].close : day > 0 ? days[day - 1].close : null;
      if (w === null) expect(got[i]).toBeNull(); else expect(got[i]).toBe(w);
    });
    const r = await runPine(head + 'plot(request.security(syminfo.tickerid, "15", close))', chart, {}, { market: ds, feed });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toContain('DATA');
  });

  it('fails with a message naming the symbol and timeframe', async () => {
    const s = fakeServer(base);
    const run = (src: string, m = market) => runPine(head + src, chart, {}, { market: m, feed: s.feed });
    const sec = await run('plot(request.security(syminfo.tickerid, "1S", close))');
    expect(sec.ok).toBe(false);
    if (!sec.ok) expect(sec.error.message).toMatch(/BTCUSDT.*1S|1S.*BTCUSDT/);
    s.failWith = 'HTTP 503';
    const fail = await run('plot(request.security(syminfo.tickerid, "W", close))');
    expect(fail.ok).toBe(false);
    if (!fail.ok) expect(fail.error.message).toMatch(/BTCUSDT.*HTTP 503/);
    s.failWith = undefined;
    const span = await run('plot(request.security(syminfo.tickerid, "1", close))');
    expect(span.ok).toBe(false);
    if (!span.ok) expect(span.error.message).toMatch(/BTCUSDT.*20000/);
    const other = await run('plot(request.security("NOPE:ETHUSDT", "D", close))');
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.message).toContain('unknown data source "NOPE"');
  });
});

describe('request.security on another symbol', () => {
  const bybit = candles15(96 * 60, 7, 200);
  const eth = candles15(96 * 60, 11, 50);
  const ethUsd = candles15(96 * 60, 13, 30);
  const markets = { 'binance|BTCUSDT': base, 'bybit|BTCUSDT': bybit, 'binance|ETHUSDT': eth, 'coinbase|ETH-USD': ethUsd, 'hyperliquid-perps|BTC': bybit };
  const server = () => fakeServer(base, { markets });
  const run = (src: string, s = server(), m: PineMarket = market, c: Candle[] = chart) => runPine(head + src, c, {}, { market: m, feed: s.feed });
  const ok = async (src: string, s = server(), m: PineMarket = market) => {
    const r = await run(src, s, m);
    if (!r.ok) throw new Error(r.error.message);
    return r.plots[0].values;
  };
  const seen = (s: ReturnType<typeof server>) => [...new Set(s.calls.map((c) => `${c.providerId}|${c.symbol}|${c.timeframe}`))].sort();

  it('BYBIT:BTCUSDT on a Binance BTCUSDT chart reads Bybit at the chart timeframe, never the chart bars', async () => {
    const s = server();
    const got = await ok('plot(request.security("BYBIT:BTCUSDT", "", close))', s);
    const want = hourlyOf(bybit);
    chart.slice(0, -1).forEach((_, i) => expect(got[i]).toBe(want[i].close));
    expect(got[5]).not.toBe(chart[5].close);
    expect(seen(s)).toEqual(['bybit|BTCUSDT|1h']);
  });

  it('BYBIT:BTCUSDT at "D" matches a hand-computed daily close of Bybit, not Binance', async () => {
    const s = server();
    const got = await ok('plot(request.security("BYBIT:BTCUSDT", "D", close))', s);
    const days = buildBars(hourlyOf(bybit), '1d');
    chart.forEach((_, i) => {
      const day = Math.floor(i / 24);
      const w = i % 24 === 23 ? days[day].close : day > 0 ? days[day - 1].close : null;
      if (w === null) expect(got[i], String(i)).toBeNull(); else expect(got[i], String(i)).toBe(w);
    });
    expect(seen(s).every((c) => c.startsWith('bybit|BTCUSDT|'))).toBe(true);
  });

  it('routes by prefix: none, own prefix, lower case, another provider, a hyphenated id', async () => {
    const cases: Array<[string, string]> = [
      ['ETHUSDT', 'binance|ETHUSDT|1h'],
      ['BINANCE:ETHUSDT', 'binance|ETHUSDT|1h'],
      ['binance:ETHUSDT', 'binance|ETHUSDT|1h'],
      ['COINBASE:ETH-USD', 'coinbase|ETH-USD|1h'],
      ['HYPERLIQUID-PERPS:BTC', 'hyperliquid-perps|BTC|1h'],
    ];
    for (const [sym, call] of cases) {
      const s = server();
      await ok(`plot(request.security("${sym}", "", close))`, s);
      expect(seen(s), sym).toEqual([call]);
    }
  });

  it('the chart own symbol (full id, bare ticker, either case) is the chart data and fetches nothing', async () => {
    for (const sym of ['BTCUSDT', 'BINANCE:BTCUSDT', 'binance:btcusdt', 'syminfo.tickerid']) {
      const s = server();
      const arg = sym === 'syminfo.tickerid' ? sym : `"${sym}"`;
      const got = await ok(`plot(request.security(${arg}, "", close))`, s);
      chart.forEach((c, i) => expect(got[i]).toBe(c.close));
      expect(s.calls).toHaveLength(0);
    }
  });

  it('reads a symbol from input.symbol, a computed string, a series string and the named symbol argument', async () => {
    const want = (m: string) => hourlyOf(m === 'bybit' ? bybit : eth).map((c) => c.close);
    const b = want('bybit');
    for (const src of [
      'sym = input.symbol("BYBIT:BTCUSDT", "S")\nplot(request.security(sym, "", close))',
      'sym = "BYBIT:" + "BTCUSDT"\nplot(request.security(sym, "", close))',
      'plot(request.security(symbol = "BYBIT:BTCUSDT", timeframe = "", expression = close))',
      'plot(request.security("BYBIT:BTCUSDT", "", close, lookahead = barmerge.lookahead_off))',
      'string s = bar_index >= 0 ? "BYBIT:BTCUSDT" : "x"\nplot(request.security(s, "", close))',
    ]) {
      const got = await ok(src);
      expect(got.slice(0, 100), src).toEqual(b.slice(0, 100));
    }
    expect(want('eth')[0]).not.toBe(b[0]);
  });

  it('stops on a prefix Vost has no provider for, naming it and listing the provider ids', async () => {
    const r = await run('plot(request.security("FOO:BTCUSDT", "", close))');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('"FOO"');
      for (const id of ['binance', 'coinbase', 'bybit', 'hyperliquid-perps', 'yahoo', 'demo']) expect(r.error.message).toContain(id);
    }
    const lt = await run('plot(array.size(request.security_lower_tf("FOO:BTCUSDT", "15", close)))');
    expect(lt.ok).toBe(false);
    if (!lt.ok) expect(lt.error.message).toContain('"FOO"');
  });

  it('a dataset chart reads a symbol with a provider prefix, and stops on one without', async () => {
    const ds: PineMarket = { providerId: 'csv', symbol: 'DATA', barSeconds: 3600, dataset: true };
    const s = server();
    const got = await ok('plot(request.security("BYBIT:BTCUSDT", "", close))', s, ds);
    expect(got[3]).toBe(hourlyOf(bybit)[3].close);
    const bare = await run('plot(request.security("BTCUSDT", "", close))', server(), ds);
    expect(bare.ok).toBe(false);
    if (!bare.ok) expect(bare.error.message).toContain('imported dataset chart can only read a symbol with a provider prefix');
  });

  it('a missing symbol stops with symbol not found on the provider; another failure keeps the server message', async () => {
    const s = server();
    const miss = await run('plot(request.security("COINBASE:NOPE", "D", close))', s);
    expect(miss.ok).toBe(false);
    if (!miss.ok) expect(miss.error.message).toContain('request.security(COINBASE:NOPE, D): symbol not found on Coinbase');
    s.failWith = 'HTTP 500 upstream is down';
    const bad = await run('plot(request.security("BYBIT:BTCUSDT", "D", close))', s);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.message).toContain('HTTP 500 upstream is down');
  });

  it('ignore_invalid_symbol gives na on every bar and a warning', async () => {
    const r = await run('plot(request.security("COINBASE:NOPE", "D", close, ignore_invalid_symbol = true))');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plots[0].values.every((v) => v === null)).toBe(true);
      expect((r.messages?.logs ?? []).filter((m) => m.level === 'warning' && /returns na/.test(m.text))).toHaveLength(1);
    }
  });

  it('same-timeframe bars of another symbol are clipped to the run end, and cutting later candles keeps earlier values', async () => {
    const src = 'plot(request.security("BYBIT:BTCUSDT", "", close))';
    const s = server();
    const full = await ok(src, s);
    const cut = await run(src, s, market, chart.slice(0, 500));
    expect(cut.ok).toBe(true);
    if (cut.ok) {
      expect(cut.plots[0].values).toHaveLength(500);
      expect(cut.plots[0].values).toEqual(full.slice(0, 500));
    }
    for (const c of s.calls) expect(c.to! * 1000).toBeLessThanOrEqual(chart.at(-1)!.time * 1000 + 3600000);
  });

  it('the forming day of another symbol is built from its own bars, never its final close', async () => {
    const cut = chart.slice(0, 24 * 40 + 5);
    const s = server();
    const hi = await ok('plot(request.security("BYBIT:BTCUSDT", "D", high, lookahead = barmerge.lookahead_on))', s);
    const r = await run('plot(request.security("BYBIT:BTCUSDT", "D", high, lookahead = barmerge.lookahead_on))', s, market, cut);
    expect(r.ok).toBe(true);
    const own = hourlyOf(bybit).slice(24 * 40, 24 * 40 + 5);
    if (r.ok) expect(r.plots[0].values.at(-1)).toBe(Math.max(...own.map((c) => c.high)));
    expect(hi).toHaveLength(chart.length);
  });

  it('a second run makes no second fetch (feed cache)', async () => {
    const s = server();
    await ok('plot(request.security("BYBIT:BTCUSDT", "D", close))', s);
    const n = s.calls.length;
    expect(n).toBeGreaterThan(0);
    await ok('plot(request.security("BYBIT:BTCUSDT", "D", close))', s);
    expect(s.calls).toHaveLength(n);
  });

  it('syminfo inside the expression reports the other symbol, outside it the chart', async () => {
    const r = await run('plot(request.security("COINBASE:ETH-USD", "", syminfo.prefix == "COINBASE" and syminfo.ticker == "ETH-USD" and syminfo.tickerid == "COINBASE:ETH-USD" ? 1 : 0))\nplot(syminfo.prefix == "BINANCE" and syminfo.ticker == "BTCUSDT" ? 1 : 0)');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plots[0].values.at(-2)).toBe(1);
      expect(r.plots[1].values.at(-1)).toBe(1);
    }
  });

  it('security_lower_tf on another symbol gives four 15 minute closes per hourly bar', async () => {
    const r = await run('plot(array.size(request.security_lower_tf("BYBIT:BTCUSDT", "15", close)))\nplot(array.get(request.security_lower_tf("BYBIT:BTCUSDT", "15", close), 3))');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.plots[0].values.slice(5, 50).every((v) => v === 4)).toBe(true);
      expect(r.plots[1].values[10]).toBe(bybit[43].close);
    }
  });

  it('a higher timeframe of another symbol equals a hand calculation (EMA of daily closes)', async () => {
    const got = await ok('plot(request.security("COINBASE:ETH-USD", "D", ta.ema(close, 5)))');
    const e = ema(buildBars(hourlyOf(ethUsd), '1d').map((b) => b.close), 5);
    chart.slice(0, -24).forEach((_, i) => {
      const day = Math.floor(i / 24);
      const w = e[i % 24 === 23 ? day : day - 1] ?? null;
      if (w === null) expect(got[i]).toBeNull(); else expect(got[i]).toBeCloseTo(w, 9);
    });
  });
});

describe('request.currency_rate', () => {
  const markets = { 'binance|BTCUSDT': base, 'binance|USDTEUR': candles15(96 * 60, 5, 2) };
  const server = () => fakeServer(base, { markets });
  const run = (src: string, s = server()) => runPine(head + src, chart, {}, { market, feed: s.feed });

  it('gives the close of a direct pair', async () => {
    const r = await run('plot(request.currency_rate("BTC", "USDT"))');
    expect(r.ok).toBe(true);
    if (r.ok) chart.forEach((c, i) => expect(r.plots[0].values[i]).toBe(c.close));
  });

  it('gives 1/close of an inverse pair', async () => {
    const r = await run('plot(request.currency_rate("USDT", "BTC"))');
    expect(r.ok).toBe(true);
    if (r.ok) chart.forEach((c, i) => expect(r.plots[0].values[i]).toBeCloseTo(1 / c.close, 12));
  });

  it('stops naming both currencies for a pair the provider lacks, unless ignore_invalid_currency', async () => {
    const r = await run('plot(request.currency_rate("BTC", "XYZ"))');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/BTC.*XYZ/);
    const na = await run('plot(request.currency_rate("BTC", "XYZ", ignore_invalid_currency = true))');
    expect(na.ok).toBe(true);
    if (na.ok) expect(na.plots[0].values.every((v) => v === null)).toBe(true);
  });

  it('one currency to itself is 1', async () => {
    const r = await run('plot(request.currency_rate("USDT", "USDT"))');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plots[0].values.every((v) => v === 1)).toBe(true);
  });
});
