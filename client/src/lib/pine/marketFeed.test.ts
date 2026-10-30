import { describe, expect, it } from 'vitest';
import { MAX_BARS } from '../../../../shared/market';
import { buildBars } from '../../../../shared/timeframes';
import { createMarketFeed, intervalEndMs } from './marketFeed';
import { START, candles15, fakeServer } from './securityFixture';

const base = candles15(96 * 30);
const DAY = 86400_000;
const req = (toMs: number, fromMs = START * 1000) => ({ providerId: 'p', symbol: 'S', interval: '1d' as const, fromMs, toMs });

describe('market feed', () => {
  it('returns finished bars only: the day holding the end is never handed out', async () => {
    const s = fakeServer(base);
    const bars = await s.feed.bars(req(START * 1000 + 5 * DAY + 3600_000));
    expect(bars.map((b) => b.time)).toEqual([0, 1, 2, 3, 4].map((d) => START + d * 86400));
    const exact = await s.feed.bars(req(START * 1000 + 5 * DAY - 1));
    expect(exact).toHaveLength(5);
  });

  it('one fetch serves many runs on the same data, and a later end fetches only the missing range', async () => {
    const s = fakeServer(base);
    const end = START * 1000 + 10 * DAY - 1;
    await Promise.all(Array.from({ length: 20 }, () => s.feed.bars(req(end))));
    expect(s.calls).toHaveLength(1);
    const later = await s.feed.bars(req(end + 5 * DAY));
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1].from).toBe((end + 1) / 1000);
    expect(later).toHaveLength(15);
    expect(later).toEqual(buildBars(base, '1d').slice(0, 15));
  });

  it('fetches an earlier range it does not hold and keeps the bars contiguous', async () => {
    const s = fakeServer(base);
    await s.feed.bars(req(START * 1000 + 20 * DAY - 1, START * 1000 + 10 * DAY));
    const all = await s.feed.bars(req(START * 1000 + 20 * DAY - 1));
    expect(all).toHaveLength(20);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1].to).toBe((START * 1000 + 10 * DAY - 1) / 1000 | 0);
  });

  it('keeps separate bars per symbol, interval and source', async () => {
    const s = fakeServer(base);
    const end = START * 1000 + 10 * DAY - 1;
    await s.feed.bars(req(end));
    await s.feed.bars({ ...req(end), symbol: 'T' });
    await s.feed.bars({ ...req(end), source: 'built' });
    await s.feed.bars({ ...req(end), interval: '12h' });
    expect(s.calls).toHaveLength(4);
  });

  it('asks again for the tail when the end is within one interval of the clock and the newest bar is not published yet', async () => {
    const calls: number[] = [];
    let published = 8;
    const end = START * 1000 + 10 * DAY - 1;
    const near = createMarketFeed(() => async (r) => {
      calls.push(r.from ?? 0);
      return buildBars(base, r.timeframe).slice(0, published).filter((b) => b.time >= (r.from ?? 0) && b.time <= (r.to ?? 0));
    }, () => end + 3600_000);
    expect(await near.bars(req(end))).toHaveLength(8);
    published = 10;
    expect(await near.bars(req(end))).toHaveLength(10);
    expect(calls).toEqual([START, START + 8 * 86400]);
    // Far from the clock, the same hole is taken as real and not asked for again.
    const far = createMarketFeed(() => async (r) => { calls.push(-1); return buildBars(base, r.timeframe).slice(0, 8).filter((b) => b.time <= (r.to ?? 0)); }, () => end + 30 * DAY);
    await far.bars(req(end));
    await far.bars(req(end));
    expect(calls.filter((c) => c === -1)).toHaveLength(1);
  });

  it('a live chart asks nothing more while the forming day goes on, and fetches the day once it has ended', async () => {
    const s = fakeServer(base);
    const clock = START * 1000 + 10 * DAY + 3 * 3600_000;
    const live = createMarketFeed(() => async (r) => { s.calls.push(r); return buildBars(base, r.timeframe).filter((b) => b.time >= (r.from ?? 0) && b.time <= (r.to ?? 0)); }, () => clock);
    for (const h of [3, 4, 5, 6]) expect(await live.bars(req(START * 1000 + 10 * DAY + h * 3600_000 - 1))).toHaveLength(10);
    expect(s.calls).toHaveLength(1);
    expect(await live.bars(req(START * 1000 + 11 * DAY + 3600_000))).toHaveLength(11);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1].from).toBe(START + 10 * 86400);
  });

  it('rejects a span above MAX_BARS and a failing fetch, caching nothing', async () => {
    const s = fakeServer(base);
    await expect(s.feed.bars({ ...req(START * 1000 + 100 * DAY), interval: '1m' })).rejects.toThrow(String(MAX_BARS));
    expect(s.calls).toHaveLength(0);
    s.failWith = 'HTTP 503';
    await expect(s.feed.bars(req(START * 1000 + 10 * DAY))).rejects.toThrow('HTTP 503');
    s.failWith = undefined;
    expect(await s.feed.bars(req(START * 1000 + 10 * DAY))).toHaveLength(10);
  });

  it('knows a calendar month', () => {
    expect(intervalEndMs(Date.UTC(2024, 1, 1), '1M')).toBe(Date.UTC(2024, 2, 1));
    expect(intervalEndMs(Date.UTC(2024, 0, 1), '12h')).toBe(Date.UTC(2024, 0, 1, 12));
  });
});
