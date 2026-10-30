/**
 * `request.currency_rate(from, to)` from the chart provider's own pair: `BTC`/`USDT` is the close of `BTCUSDT` (or
 * `BTC-USDT`, `BTC/USDT`, `BTC_USDT`), the inverse pair gives 1/close. PineTS asks for a rate synchronously, so a run
 * that meets a pair it has no bars for gets na, remembers the pair, and `runWithRates` loads it and runs again.
 */
import { getProvider } from '../providers';
import type { Candle } from '../../types';
import { marketTimeframe, vostInterval } from './market';
import { defaultMarketFeed, intervalEndMs, type MarketFeed } from './marketFeed';
import type { PineMarket } from './types';

interface PairBars {
  /** Open times (ms) ascending, and the rate on each bar. */
  times: number[];
  rates: number[];
}

type Entry = PairBars | { error: string };

export class CurrencyRates {
  private table = new Map<string, Entry>();
  private pending = new Map<string, [string, string]>();

  constructor(
    private candles: Candle[],
    private market: PineMarket | undefined,
    private feed: MarketFeed = defaultMarketFeed(),
  ) {}

  get needsLoad(): boolean {
    return this.pending.size > 0;
  }

  /** The rate on the chart bar opening at `openMs`, na when the pair has no bar by then, or when this run has not loaded the pair yet. */
  rate(from: string, to: string, openMs: number, ignore: boolean): number {
    const key = `${from}/${to}`;
    const entry = this.table.get(key);
    if (!entry) {
      this.pending.set(key, [from, to]);
      return NaN;
    }
    if ('error' in entry) {
      if (ignore) return NaN;
      throw new Error(entry.error);
    }
    let lo = 0;
    let hi = entry.times.length - 1;
    let at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (entry.times[mid] <= openMs) { at = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return at < 0 ? NaN : entry.rates[at];
  }

  /** Loads every pair a run asked for and had to leave na. */
  async load(): Promise<void> {
    const todo = [...this.pending.entries()];
    this.pending.clear();
    for (const [key, [from, to]] of todo) this.table.set(key, await this.loadPair(from, to));
  }

  private async loadPair(from: string, to: string): Promise<Entry> {
    const name = `request.currency_rate(${from}, ${to})`;
    const m = this.market;
    if (!m || m.dataset) return { error: `${name}: an imported dataset chart has no provider to read a ${from}/${to} rate from` };
    const interval = vostInterval(marketTimeframe(m, this.candles));
    if (!interval) return { error: `${name}: the chart's timeframe is not one Vost has bars for` };
    const fromMs = this.candles[0].time * 1000;
    const toMs = intervalEndMs(this.candles[this.candles.length - 1].time * 1000, interval) - 1;
    const forms = (a: string, b: string) => [`${a}${b}`, `${a}-${b}`, `${a}/${b}`, `${a}_${b}`];
    const tries = [...forms(from, to).map((s) => ({ s, inverse: false })), ...forms(to, from).map((s) => ({ s, inverse: true }))];
    let failure = '';
    for (const t of tries) {
      try {
        const bars = await this.feed.bars({ providerId: m.providerId, symbol: t.s, interval, ...(m.source && { source: m.source }), fromMs, toMs });
        if (bars.length === 0) continue;
        return { times: bars.map((c) => c.time * 1000), rates: bars.map((c) => (t.inverse ? 1 / c.close : c.close)) };
      } catch (e) {
        if ((e as { status?: number }).status !== 404 && !failure) failure = e instanceof Error ? e.message : String(e);
      }
    }
    const provider = getProvider(m.providerId).name;
    return { error: `${name}: ${provider} has no ${from}${to} or ${to}${from} pair${failure ? ` (${failure})` : ''}, so there is no ${from} to ${to} rate` };
  }
}

/** Runs `attempt`, and again after loading the pairs it left na, until it needs no more (at most 8 rounds). */
export async function runWithRates<T>(rates: CurrencyRates, attempt: () => Promise<T>): Promise<T> {
  for (let round = 0; ; round++) {
    let out: T;
    try {
      out = await attempt();
    } catch (e) {
      if (!rates.needsLoad || round >= 8) throw e;
      await rates.load();
      continue;
    }
    if (!rates.needsLoad || round >= 8) return out;
    await rates.load();
  }
}
