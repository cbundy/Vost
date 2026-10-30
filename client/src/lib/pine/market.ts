/**
 * The market a Pine script runs in: the chart's symbol, timeframe and market details, served to PineTS through an
 * `IProvider`. Pure (no DOM, no network), so it runs in the worker and in Node.
 *
 * Known limits: the browser side knows no exchange time zone or official tick size, so `syminfo.timezone` is UTC
 * (right for every crypto provider, not for stocks) and `syminfo.mintick` is estimated from the prices.
 */
import type { IProvider, ISymbolInfo } from 'pinets';
import { intervalSeconds, parseInterval, type Interval } from '../../../../shared/market';
import { PROVIDER_CATALOG } from '../../../../shared/providerCatalog';
import { buildBars } from '../../../../shared/timeframes';
import type { Candle } from '../../types';
import { getProvider } from '../providers';
import { defaultMarketFeed, intervalEndMs, type MarketFeed } from './marketFeed';
import { decodeRoute, type Route } from './requestRouting';
import type { PineMarket } from './types';

/** The Pine timeframe string of a Vost interval (`15m` -> "15", `2h` -> "120", `3d` -> "3D", `1w` -> "W", `1M` -> "M"). */
export function pineTimeframe(interval: string): string | null {
  const p = parseInterval(interval);
  if (!p) return null;
  const suffix = (s: string) => (p.n === 1 ? s : `${p.n}${s}`);
  switch (p.unit) {
    case 'm': return String(p.n);
    case 'h': return String(p.n * 60);
    case 'd': return suffix('D');
    case 'w': return suffix('W');
    default: return suffix('M');
  }
}

/** The Pine timeframe of a bar length in seconds (for a dataset with no named interval). */
export function pineTimeframeOfSeconds(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s >= 604800 && s % 604800 === 0) return s === 604800 ? 'W' : `${s / 604800}W`;
  if (s >= 86400 && s % 86400 === 0) return s === 86400 ? 'D' : `${s / 86400}D`;
  return String(Math.max(1, Math.round(s / 60)));
}

/** Bar length in seconds of the candles themselves: the smallest gap among the first bars. */
function spacingSeconds(candles: Candle[]): number {
  let best = Infinity;
  for (let i = 1; i < Math.min(candles.length, 200); i++) {
    const g = candles[i].time - candles[i - 1].time;
    if (g > 0 && g < best) best = g;
  }
  return Number.isFinite(best) ? best : 86400;
}

/** The Pine timeframe a run uses: the market's interval, else its bar length, else the candle spacing. */
export function marketTimeframe(market: PineMarket | undefined, candles: Candle[]): string {
  if (market?.interval) {
    const tf = pineTimeframe(market.interval);
    if (tf) return tf;
  }
  if (market?.barSeconds && market.barSeconds > 0) return pineTimeframeOfSeconds(market.barSeconds);
  return pineTimeframeOfSeconds(spacingSeconds(candles));
}

/** Compares timeframes by meaning ("D" and "1D" are the same). */
export function normalizeTimeframe(tf: string): string {
  const m = /^(\d*)([SDWM]?)$/i.exec(tf.trim());
  if (!m) return tf.trim().toUpperCase();
  return `${m[1] || '1'}${m[2].toUpperCase()}`;
}

function decimals(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const s = String(Math.abs(n));
  const e = /e-(\d+)$/.exec(s);
  if (e) {
    const mant = /\.(\d+)e/.exec(s);
    return Math.min(10, Number(e[1]) + (mant ? mant[1].length : 0));
  }
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : Math.min(10, s.length - dot - 1);
}

/** The smallest price step seen in the candles: one unit of the largest decimal count of open/high/low/close. */
export function estimateMintick(candles: Candle[]): number {
  let d = 0;
  for (const c of candles) d = Math.max(d, decimals(c.open), decimals(c.high), decimals(c.low), decimals(c.close));
  return Number((10 ** -d).toFixed(d));
}

/** The ticker, prefix and type a market reports. A missing market is the documented default (ticker `VOST`). */
export function marketIdentity(market: PineMarket | undefined): { ticker: string; prefix: string; tickerid: string; type: string } {
  if (!market) return { ticker: 'VOST', prefix: 'VOST', tickerid: 'VOST:VOST', type: '' };
  return identityOf(market.providerId, market.symbol, Boolean(market.dataset));
}

function identityOf(providerId: string, symbol: string, dataset: boolean) {
  const prefix = providerId.toUpperCase();
  const type = dataset || providerId === 'demo' ? '' : providerId === 'yahoo' ? 'stock' : 'crypto';
  return { ticker: symbol, prefix, tickerid: `${prefix}:${symbol}`, type };
}

function symbolInfo(id: ReturnType<typeof marketIdentity>, candles: Candle[], tf: string): ISymbolInfo {
  const mintick = estimateMintick(candles);
  const pricescale = Math.round(1 / mintick);
  return {
    current_contract: '', description: id.ticker, isin: '', main_tickerid: id.tickerid, prefix: id.prefix, root: id.ticker,
    ticker: id.ticker, tickerid: id.tickerid, type: id.type, basecurrency: '', country: '', currency: '', timezone: 'UTC',
    employees: NaN, industry: '', sector: '', shareholders: NaN, shares_outstanding_float: NaN, shares_outstanding_total: NaN,
    expiration_date: NaN, session: tf === 'D' || /[DWM]$/.test(tf) ? '0000-2400' : '24x7', volumetype: 'base', mincontract: 1,
    minmove: 1, mintick, pointvalue: 1, pricescale, recommendations_buy: NaN, recommendations_buy_strong: NaN,
    recommendations_date: NaN, recommendations_hold: NaN, recommendations_sell: NaN, recommendations_sell_strong: NaN,
    recommendations_total: NaN, target_price_average: NaN, target_price_date: NaN, target_price_estimates: NaN,
    target_price_high: NaN, target_price_low: NaN, target_price_median: NaN,
  };
}

/** Length of one bar opening at `openMs`, in ms (a month is the calendar month). */
function barLengthMs(market: PineMarket | undefined, tf: string, openMs: number): number {
  const p = market?.interval ? parseInterval(market.interval) : null;
  if (p?.unit === 'M') {
    const d = new Date(openMs);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + p.n, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()) - openMs;
  }
  const m = /^(\d*)([DWM]?)$/.exec(tf);
  const n = Number(m?.[1] || 1);
  if (m?.[2] === 'D') return n * 86400000;
  if (m?.[2] === 'W') return n * 604800000;
  if (m?.[2] === 'M') return n * 2592000000;
  return n * 60000;
}

/** Each bar's close: its open plus the interval, capped at the next bar's open, minus 1 ms. */
export function toKlines(candles: Candle[], market: PineMarket | undefined, tf: string) {
  const n = candles.length;
  return candles.map((c, i) => {
    const openMs = c.time * 1000;
    const full = openMs + barLengthMs(market, tf, openMs);
    const end = i + 1 < n ? Math.min(full, candles[i + 1].time * 1000) : full;
    return {
      openTime: openMs, closeTime: end - 1, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
      quoteAssetVolume: 0, numberOfTrades: 0, takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0,
    };
  });
}

type Kline = ReturnType<typeof toKlines>[number];

/** The Vost interval of a Pine timeframe string (`"720"` is `12h`, `"D"` is `1d`, `"W"` is `1w`), or null for seconds and anything else. */
export function vostInterval(timeframe: string): Interval | null {
  const m = /^(\d*)([SDWM]?)$/i.exec(timeframe.trim());
  if (!m || !(m[1] || m[2])) return null;
  const n = Number(m[1] || 1);
  const unit = m[2].toUpperCase();
  if (n < 1 || unit === 'S') return null;
  const text: string = unit === 'D' ? `${n}d` : unit === 'W' ? `${n}w` : unit === 'M' ? `${n}M` : n % 60 === 0 ? `${n / 60}h` : `${n}m`;
  return parseInterval(text) ? (text as Interval) : null;
}

function kline(c: Candle, closeTime: number): Kline {
  return {
    openTime: c.time * 1000, closeTime, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume,
    quoteAssetVolume: 0, numberOfTrades: 0, takerBuyBaseAssetVolume: 0, takerBuyQuoteAssetVolume: 0, ignore: 0,
  };
}

/**
 * Higher-timeframe bars as the run may see them. `finished` are the bars whose interval ended by the run's end; the bar
 * holding the run's last chart bar is rebuilt from `candles` (the symbol's own bars at the chart's timeframe: the chart's
 * candles, or another symbol's) and closes at its full interval end. `chart` only places each bar on the chart.
 *
 * A finished bar closes with the last chart bar inside `[its open, the next bar's open)`, so with `lookahead_off` its
 * value first shows on that chart bar (a stock's daily value on the day's last session bar, with no exchange calendar).
 * With no chart bar inside, it closes at its own interval end (capped at the next bar's open) minus 1 ms.
 */
export function higherKlines(chart: Kline[], candles: Candle[], finished: Candle[], interval: Interval, endTime: number): Kline[] {
  const out: Kline[] = [];
  let ci = 0;
  for (let j = 0; j < finished.length; j++) {
    const c = finished[j];
    const open = c.time * 1000;
    if (open > endTime) break;
    const natural = intervalEndMs(open, interval);
    const next = j + 1 < finished.length ? Math.min(natural, finished[j + 1].time * 1000) : natural;
    while (ci < chart.length && chart[ci].openTime < open) ci++;
    let last = -1;
    for (let k = ci; k < chart.length && chart[k].openTime < next; k++) last = k;
    out.push(kline(c, last >= 0 ? Math.min(chart[last].closeTime, next - 1) : next - 1));
  }
  // The forming bar: candles after the last finished bar's interval (else from the interval's UTC bucket start).
  if (candles.length === 0) return out;
  const lastCandle = candles[candles.length - 1];
  const lastFinished = finished.length ? finished[finished.length - 1] : undefined;
  let formingOpen = lastFinished ? intervalEndMs(lastFinished.time * 1000, interval) : buildBars([lastCandle], interval)[0].time * 1000;
  if (lastFinished && lastCandle.time * 1000 >= formingOpen) {
    // After a weekend or holiday the first forming candle lies several intervals on: open at the bucket that holds it,
    // stepping from the finished bars' own stamps (a stock's daily bars are not at UTC midnight).
    const first = candles.find((c) => c.time * 1000 >= formingOpen)!.time * 1000;
    while (intervalEndMs(formingOpen, interval) <= first) formingOpen = intervalEndMs(formingOpen, interval);
  }
  if (lastCandle.time * 1000 >= formingOpen) {
    const part = candles.filter((c) => c.time * 1000 >= formingOpen);
    const agg = part.reduce((a, c) => ({ ...a, high: Math.max(a.high, c.high), low: Math.min(a.low, c.low), close: c.close, volume: a.volume + c.volume }), { ...part[0] });
    out.push(kline({ ...agg, time: formingOpen / 1000 }, intervalEndMs(formingOpen, interval) - 1));
  }
  return out;
}

/** What PineTS runs on: the chart's own candles, and the chart's symbol or another symbol (from `feed`) at any timeframe. */
export function createMarketProvider(
  candles: Candle[],
  market: PineMarket | undefined,
  feed: MarketFeed = defaultMarketFeed(),
): { provider: IProvider; ticker: string; timeframe: string; endTime: number } {
  const tf = marketTimeframe(market, candles);
  const id = marketIdentity(market);
  const klines = toKlines(candles, market, tf);
  const endTime = klines.length ? klines[klines.length - 1].closeTime : 0;
  const own = (t: string) => {
    const u = t.toUpperCase();
    return u === id.ticker.toUpperCase() || u === id.tickerid.toUpperCase();
  };

  async function otherTimeframe(m: PineMarket, timeframe: string, startMs: number): Promise<Kline[]> {
    const interval = vostInterval(timeframe);
    if (!interval) throw new Error(`${timeframe} is not a timeframe Vost has bars for`);
    const wantMs = intervalSeconds(interval) * 1000;
    const chartMs = barLengthMs(m, tf, candles[candles.length - 1].time * 1000);
    if (wantMs === chartMs) return klines;
    const from = Math.min(startMs, candles[0].time * 1000);
    if (wantMs < chartMs) {
      if (m.dataset) throw new Error(`the imported data has ${tf} bars and cannot give lower ones`);
      const bars = await feed.bars({ providerId: m.providerId, symbol: m.symbol, interval, ...(m.source && { source: m.source }), fromMs: from, toMs: endTime });
      return bars.map((c) => kline(c, intervalEndMs(c.time * 1000, interval) - 1)).filter((k) => k.closeTime <= endTime);
    }
    if (m.dataset) {
      // Built from the dataset's own candles; the oldest bucket may start before the data and is left out.
      const built = buildBars(candles, interval);
      const bars = built.filter((c, i) => i > 0 || c.time >= candles[0].time).filter((c) => intervalEndMs(c.time * 1000, interval) <= endTime + 1);
      return higherKlines(klines, candles, bars, interval, endTime);
    }
    const bars = await feed.bars({ providerId: m.providerId, symbol: m.symbol, interval, ...(m.source && { source: m.source }), fromMs: from, toMs: endTime });
    return higherKlines(klines, candles, bars.filter((c) => intervalEndMs(c.time * 1000, interval) <= endTime + 1), interval, endTime);
  }

  /** What was loaded for each other symbol (route id), for its `syminfo`. */
  const loaded = new Map<string, { candles: Candle[]; tf: string }>();

  /** Another symbol's bars, placed on the chart by the rules of the chart's own symbol at another timeframe. */
  async function otherSymbol(m: PineMarket, route: Route, tickerId: string, timeframe: string, startMs: number): Promise<Kline[]> {
    const interval = vostInterval(timeframe);
    if (!interval) throw new Error(`${timeframe} is not a timeframe Vost has bars for`);
    const info = PROVIDER_CATALOG.find((p) => p.id === route.providerId);
    // The chart's Build setting rides along to its own provider; another provider is asked for built bars only where it has to.
    const sourceOf = (iv: Interval) => (m.source && (route.providerId === m.providerId || info?.builtTimeframes.includes(iv as never)) ? { source: m.source } : {});
    const get = (iv: Interval) => feed.bars({ providerId: route.providerId, symbol: route.symbol, interval: iv, ...sourceOf(iv), fromMs: Math.min(startMs, candles[0].time * 1000), toMs: endTime });
    const wantMs = intervalSeconds(interval) * 1000;
    const chartMs = barLengthMs(m, tf, candles[candles.length - 1].time * 1000);
    let out: Kline[];
    let own: Candle[];
    if (wantMs <= chartMs) {
      own = await get(interval);
      out = own.map((c) => kline(c, intervalEndMs(c.time * 1000, interval) - 1)).filter((k) => k.closeTime <= endTime);
    } else {
      const fine = vostInterval(tf);
      if (!fine) throw new Error(`the chart's ${tf} bars are not ones Vost has bars for`);
      const [bars, fineBars] = await Promise.all([get(interval), get(fine)]);
      own = fineBars;
      out = higherKlines(klines, fineBars, bars.filter((c) => intervalEndMs(c.time * 1000, interval) <= endTime + 1), interval, endTime);
    }
    if (out.length === 0) throw new Error(`no ${timeframe} bars in the chart's date range`);
    loaded.set(tickerId, { candles: own, tf: timeframe });
    return out;
  }

  const provider: IProvider = {
    async getMarketData(tickerId, timeframe, _limit, sDate) {
      const unavailable = new Error(`request.security(${tickerId}, ${timeframe}) needs data Vost does not load yet`);
      const route = decodeRoute(tickerId);
      if (route) {
        if (!market) throw unavailable;
        const label = `${route.providerId.toUpperCase()}:${route.symbol}`;
        try {
          return await otherSymbol(market, route, tickerId, timeframe, typeof sDate === 'number' && Number.isFinite(sDate) ? sDate : candles[0].time * 1000);
        } catch (e) {
          if ((e as { status?: number }).status === 404) {
            throw new Error(`request.security(${label}, ${timeframe}): symbol not found on ${getProvider(route.providerId).name}`);
          }
          throw new Error(`request.security(${label}, ${timeframe}): could not load ${timeframe} bars of ${label}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (!own(tickerId)) throw unavailable;
      if (normalizeTimeframe(timeframe) === normalizeTimeframe(tf)) return klines;
      if (!market) throw unavailable;
      try {
        return await otherTimeframe(market, timeframe, typeof sDate === 'number' && Number.isFinite(sDate) ? sDate : candles[0].time * 1000);
      } catch (e) {
        throw new Error(`request.security(${tickerId}, ${timeframe}): could not load ${timeframe} bars of ${market.symbol}: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
    async getSymbolInfo(tickerId) {
      const route = decodeRoute(tickerId);
      const got = route && market ? loaded.get(tickerId) : undefined;
      if (route && got) return symbolInfo(identityOf(route.providerId, route.symbol, false), got.candles, got.tf);
      return symbolInfo(id, candles, tf);
    },
    configure() {},
  };
  return { provider, ticker: id.ticker, timeframe: tf, endTime };
}
