import { describe, expect, it } from 'vitest';
import { buildBars } from '../../../../shared/timeframes';
import { sma } from '../indicators';
import type { Candle } from '../../types';
import { runPine } from './runtime';
import { candles15, fakeServer, hourlyOf } from './securityFixture';
import type { PineMarket } from './types';

const market: PineMarket = { providerId: 'binance', symbol: 'BTCUSDT', interval: '1h' };
const decl = (args = 'timeframe="D"') => `//@version=6\nindicator("x", overlay=true, ${args})\n`;
const base = candles15(96 * 60);
const chart = hourlyOf(base);
const days = buildBars(chart, '1d');

async function run(src: string, candles: Candle[] = chart, feed = fakeServer(base).feed, m: PineMarket = market) {
  return runPine(src, candles, {}, { market: m, feed });
}
async function values(src: string, candles: Candle[] = chart, feed = fakeServer(base).feed, m: PineMarket = market) {
  const r = await run(src, candles, feed, m);
  if (!r.ok) throw new Error(r.error.message);
  return r.plots[0].values;
}

describe('indicator(timeframe=...)', () => {
  const s = sma(days.map((d) => d.close), 3);

  it('shows the daily SMA only on each finished day\'s last bar (gaps on)', async () => {
    const got = await values(decl() + 'plot(ta.sma(close, 3))');
    chart.forEach((_, i) => {
      const d = Math.floor(i / 24);
      const want = i % 24 === 23 ? s[d] : null;
      if (want == null) expect(got[i]).toBeNull(); else expect(got[i]).toBeCloseTo(want, 9);
    });
    expect(got.filter((v) => v !== null).length).toBeGreaterThan(50);
  });

  it('holds the value until the next day without gaps, and equals request.security', async () => {
    const got = await values(decl('timeframe="D", timeframe_gaps=false') + 'plot(ta.sma(close, 3))');
    const ref = await values('//@version=6\nindicator("r")\nplot(request.security(syminfo.tickerid, "D", ta.sma(close, 3)))');
    expect(got).toHaveLength(chart.length);
    // Same alignment; the declared run also shows the forming day, which the finished-bar reference holds back.
    chart.forEach((_, i) => {
      if (ref[i] === null) expect(got[i] === null || i >= 24 * 59).toBe(true);
    });
    for (let i = 0; i < 24 * 59 + 23; i++) {
      if (i < 23) expect(got[i]).toBeNull();
      else expect(got[i]).toBeCloseTo(ref[i] ?? got[i]!, 9);
    }
    expect(got[23]).toBeNull(); // 3 days needed for the SMA
    expect(got[24 * 3 - 1]!).toBeCloseTo(s[2]!, 9);
    expect(got[24 * 3 + 5]!).toBeCloseTo(s[2]!, 9);
  });

  it('never shows the server\'s final close of the forming day, and cutting candles leaves earlier values', async () => {
    const feed = fakeServer(base, { finalClose: 99999 }).feed;
    const cut = chart.slice(0, 24 * 40 + 5);
    const src = decl('timeframe="D", timeframe_gaps=false') + 'plot(close)';
    const got = await values(src, cut, feed);
    expect(got.some((v) => v === 99999)).toBe(false);
    expect(got.at(-1)).toBe(cut.at(-1)!.close);
    const full = await values(src, chart, feed);
    expect(full.slice(0, 24 * 40 + 5 - 5)).toEqual(got.slice(0, 24 * 40));
  });

  it('a dataset market builds the daily bars itself and gives the same values', async () => {
    const ds: PineMarket = { providerId: 'csv', symbol: 'DATA', barSeconds: 3600, dataset: true };
    const noFeed = { bars: async () => { throw new Error('a dataset has no provider'); } };
    const src = decl() + 'plot(ta.sma(close, 3))';
    expect(await values(src, chart, noFeed, ds)).toEqual(await values(src));
  });

  it('timeframe.* report the declared timeframe', async () => {
    const got = await values(decl() + 'plot(timeframe.in_seconds())');
    expect(got.filter((v) => v !== null).every((v) => v === 86400)).toBe(true);
    const r = await run(decl() + 'plot(timeframe.isdaily ? 1 : 0)\nlog.info(timeframe.period)');
    if (!r.ok) throw new Error(r.error.message);
    expect(r.plots[0].values.filter((v) => v !== null).every((v) => v === 1)).toBe(true);
    expect(r.messages!.logs.some((l) => /^1?D$/.test(l.text))).toBe(true);
  });

  it('shapes, background colours, drawings and alerts land on the mapped bars', async () => {
    const r = await run(decl('timeframe="D"') + 'plotshape(close > open)\nbgcolor(color.red)\nlabel.new(bar_index, high)\nalertcondition(true, "a", "m")');
    if (!r.ok) throw new Error(r.error.message);
    const [shape, bg] = r.plots;
    chart.forEach((_, i) => {
      const lastOfDay = i % 24 === 23;
      if (!lastOfDay) { expect(shape.values[i]).toBeNull(); expect(bg.values[i]).toBeNull(); }
    });
    expect(bg.values.filter((v) => v !== null).length).toBeGreaterThan(50);
    const labels = r.drawings?.labels ?? [];
    expect(labels.length).toBeGreaterThan(0);
    const closes = new Set(chart.filter((_, i) => i % 24 === 23).map((c) => c.time));
    expect(closes.has(labels[0].time)).toBe(true);
    const times = r.messages!.alertConditions.flatMap((c) => c.times);
    expect(times.length).toBeGreaterThan(0);
    // alert times are the daily bars' own times (UTC midnight), not chart bar times
    expect(times.every((t) => t % 86400 === 0)).toBe(true);
  });

  it('an empty or equal timeframe runs exactly as without it', async () => {
    const plain = await run('//@version=6\nindicator("x", overlay=true)\nplot(ta.sma(close, 3))');
    for (const a of ['timeframe=""', 'timeframe="60"']) {
      expect(await run(decl(a) + 'plot(ta.sma(close, 3))')).toEqual(plain);
    }
  });

  it('inputs are the same with and without the declaration', async () => {
    const withIn = (h: string) => `${h}x = input.int(3, "Len")\nplot(ta.sma(close, x))`;
    const a = await run(withIn(decl()));
    const b = await run(withIn('//@version=6\nindicator("x", overlay=true)\n'));
    if (!a.ok || !b.ok) throw new Error('run failed');
    expect(a.inputs).toEqual(b.inputs);
  });

  it('stops with a clear message for an unusable timeframe', async () => {
    const failing = fakeServer(base);
    failing.failWith = 'HTTP 503';
    const cases: [string, Parameters<typeof run>, RegExp][] = [
      ['5', [decl('timeframe="5"') + 'plot(close)'], /indicator\(timeframe="5"\).*60.*chart.*only on the chart's timeframe or a higher/],
      ['1S', [decl('timeframe="1S"') + 'plot(close)'], /indicator\(timeframe="1S"\).*60/],
      ['feed', [decl() + 'plot(close)', chart, failing.feed], /indicator\(timeframe="D"\).*60.*HTTP 503/],
    ];
    for (const [, args, re] of cases) {
      const r = await run(...args);
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.error.message).toMatch(re); expect(r.error.message.startsWith('request.security(')).toBe(false); }
    }
    const none = await runPine(decl() + 'plot(close)', chart, {});
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.error.message).toMatch(/indicator\(timeframe="D"\).*no market/);
  });
});
