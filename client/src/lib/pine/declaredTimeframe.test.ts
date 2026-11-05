import { describe, expect, it } from 'vitest';
import { buildBars } from '../../../../shared/timeframes';
import { sma } from '../indicators';
import type { Candle } from '../../types';
import { MAX_BARS } from '../../../../shared/market';
import { remapToChart, declaresTimeframe } from './declaredTimeframe';
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
      // Only the reported Calculation values differ: the script declares the argument, the plain one does not.
      const r = await run(decl(a) + 'plot(ta.sma(close, 3))');
      if (!r.ok) throw new Error(r.error.message);
      const { calculation, ...rest } = r;
      expect(calculation).toEqual({ timeframe: a.slice(11, -1), gaps: true });
      expect(rest).toEqual(plain);
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

describe('declaresTimeframe', () => {
  const head = (args: string) => `//@version=6\nindicator(${args})\nplot(close)\n`;
  it.each([
    ['empty timeframe', head('"x", timeframe=""'), true],
    ['daily', head('"x", timeframe="D"'), true],
    ['multi-line call', '//@version=6\nindicator("x",\n  overlay=true,\n  timeframe = "D",\n  timeframe_gaps=true)\n', true],
    ['gaps only', head('"x", timeframe_gaps=true'), false],
    ['inside a string', head('"timeframe=x"'), false],
    ['inside a comment', '//@version=6\nindicator("x") // timeframe="D"\n', false],
    ['nested call', head('"x", format=format.price, precision=input(2, "timeframe=")'), false],
    ['no argument', head('"x"'), false],
    ['a strategy', '//@version=6\nstrategy("x", timeframe="D")\n', false],
  ])('%s', (_, src, want) => {
    expect(declaresTimeframe(src)).toBe(want);
  });
});

describe('Calculation overrides', () => {
  const plot = 'plot(ta.sma(close, 3))';
  const runWith = async (src: string, calculation?: { timeframe?: string; gaps?: boolean }, candles = chart, feed = fakeServer(base).feed) => {
    const r = await runPine(src, candles, {}, { market, feed, ...(calculation && { calculation }) });
    if (!r.ok) throw new Error(r.error.message);
    return r;
  };

  it('a timeframe override equals writing it in the script, gaps too', async () => {
    expect((await runWith(decl('timeframe=""') + plot, { timeframe: 'D' })).plots).toEqual((await runWith(decl('timeframe="D"') + plot)).plots);
    expect((await runWith(decl('timeframe=""') + plot, { timeframe: 'D', gaps: false })).plots).toEqual(
      (await runWith(decl('timeframe="D", timeframe_gaps=false') + plot)).plots,
    );
  });

  it('an override to the chart equals the plain run', async () => {
    const a = await runWith(decl('timeframe="D"') + plot, { timeframe: '' });
    const b = await runWith('//@version=6\nindicator("x", overlay=true)\n' + plot);
    expect(a.plots).toEqual(b.plots);
  });

  it('a script without the argument ignores the overrides and reports no calculation', async () => {
    const src = '//@version=6\nindicator("x", overlay=true)\n' + plot;
    const a = await runWith(src, { timeframe: 'D', gaps: false });
    expect(a).toEqual(await runWith(src));
    expect(a.calculation).toBeUndefined();
  });

  it('a supporting script reports its declared values', async () => {
    expect((await runWith(decl('timeframe="D", timeframe_gaps=false') + plot, { timeframe: '15' })).calculation).toEqual({ timeframe: 'D', gaps: false });
    expect((await runWith(decl('timeframe=""') + plot)).calculation).toEqual({ timeframe: '', gaps: true });
  });

  it('a lower timeframe shows the last lower bar inside each chart bar', async () => {
    const src = decl('timeframe=""');
    const closes = (await runWith(src + 'plot(close)', { timeframe: '15' })).plots[0].values;
    chart.forEach((c, i) => expect(closes[i]).toBeCloseTo(c.close, 9));
    const got = (await runWith(src + 'plot(ta.sma(close, 4))', { timeframe: '15' })).plots[0].values;
    const ref = sma(base.map((b) => b.close), 4);
    chart.forEach((_, i) => {
      const last = ref[i * 4 + 3];
      if (last == null) expect(got[i]).toBeNull(); else expect(got[i]).toBeCloseTo(last, 9);
    });
  });

  it('a dataset chart cannot give a lower timeframe', async () => {
    const ds: PineMarket = { providerId: 'csv', symbol: 'DATA', barSeconds: 3600, dataset: true };
    const r = await run(decl('timeframe=""') + 'plot(close)', chart, fakeServer(base).feed, ds);
    expect(r.ok).toBe(true);
    const low = await runPine(decl('timeframe=""') + 'plot(close)', chart, {}, { market: ds, feed: fakeServer(base).feed, calculation: { timeframe: '15' } });
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.error.message).toMatch(/Calculation timeframe 15.*cannot give lower ones/);
  });

  it('an override error names the Calculation setting, a script one names the declaration', async () => {
    const r = await runPine(decl('timeframe=""') + 'plot(close)', chart, {}, { market, feed: fakeServer(base).feed, calculation: { timeframe: '1S' } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/^Calculation timeframe 1S cannot run on a 60 chart/);
  });

  it('a lower range beyond MAX_BARS runs on the newest bars only', async () => {
    const big = candles15(MAX_BARS + 5000);
    const bigChart = hourlyOf(big).slice(-6000);
    const server = fakeServer(big);
    const r = await runWith(decl('timeframe=""') + 'plot(close)', { timeframe: '15' }, bigChart, server.feed);
    const v = r.plots[0].values;
    expect(v.at(-1)).toBeCloseTo(bigChart.at(-1)!.close, 9);
    expect(v[0]).toBeNull();
    const filled = v.filter((x) => x !== null).length;
    expect(filled).toBeGreaterThan(MAX_BARS / 4 - 10);
    expect(filled).toBeLessThan(bigChart.length);
    for (const c of server.calls) expect(((c.to ?? 0) - (c.from ?? 0)) / 900 + 1).toBeLessThanOrEqual(MAX_BARS + 1);
    expect(server.calls.length).toBeGreaterThan(0);
  });
});

describe('remapToChart', () => {
  it('keeps the last of several source bars on one chart bar', () => {
    const candles = [0, 3600, 7200].map((t) => ({ time: t, open: 1, high: 1, low: 1, close: 1, volume: 1 }));
    const k = (open: number) => ({ openTime: open * 1000, closeTime: (open + 900) * 1000 - 1 }) as any;
    const higher = [k(0), k(900), k(3600)];
    const plots = { a: { data: [{ time: 0, value: 1 }, { time: 900000, value: 2 }, { time: 3600000, value: 3 }] } };
    const out = remapToChart(plots, higher, candles, true).plots.a.data;
    expect(out.map((p: any) => p.value)).toEqual([2, 3]);
    expect(out.map((p: any) => p.time)).toEqual([0, 3600000]);
  });
});
