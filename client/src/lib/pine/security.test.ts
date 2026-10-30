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
    const other = await run('plot(request.security("ETHUSDT", "D", close))');
    expect(other.ok).toBe(false);
    if (!other.ok) expect(other.error.message).toContain('request.security(ETHUSDT, D) needs data Vost does not load yet');
  });
});
