/**
 * Stooq — free downloadable historical data (stocks, indices, forex, crypto).
 * Returns plain CSV, no key required.
 */
import type { Candle, SymbolSuggestion, Timeframe } from '../../shared/market.ts';
import { InputError, NotFoundError, UpstreamError } from './errors.ts';
import { matchSymbols } from './symbolMatch.ts';
import { STOOQ_SYMBOLS } from './stooqSymbols.ts';
import type { ProviderAdapter } from './types.ts';
import { upstreamText } from './upstream.ts';

const PROVIDER = 'Stooq';

const STOOQ_INTERVALS: Partial<Record<Timeframe, string>> = {
  '1d': 'd',
  '1w': 'w',
  '1M': 'm',
};

/**
 * Parses Stooq's fixed `Date,Open,High,Low,Close,Volume` CSV. Header names are
 * trimmed and case-insensitive; blank lines and rows without a date and a
 * close are skipped. Returns candles in file order.
 */
export function parseStooqCsv(text: string): Candle[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const col = (name: string): number => header.indexOf(name);
  const [iDate, iOpen, iHigh, iLow, iClose, iVolume] = ['date', 'open', 'high', 'low', 'close', 'volume'].map(col);
  const num = (cells: string[], i: number): number => {
    const v = i < 0 ? undefined : cells[i]?.trim();
    return v ? Number(v) : NaN;
  };
  const candles: Candle[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    const time = iDate < 0 ? NaN : Date.parse(cells[iDate]?.trim() ?? '');
    const close = num(cells, iClose);
    if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
    const volume = num(cells, iVolume);
    candles.push({
      time: Math.floor(time / 1000),
      open: num(cells, iOpen),
      high: num(cells, iHigh),
      low: num(cells, iLow),
      close,
      volume: Number.isFinite(volume) ? volume : 0,
    });
  }
  return candles;
}

export const stooqAdapter: ProviderAdapter = {
  id: 'stooq',

  async listSymbols() {
    return STOOQ_SYMBOLS;
  },

  async search(_ctx, query: string): Promise<SymbolSuggestion[]> {
    if (!query.trim()) return STOOQ_SYMBOLS;
    return matchSymbols(STOOQ_SYMBOLS, query);
  },

  async history(ctx, req) {
    const i = STOOQ_INTERVALS[req.timeframe];
    if (!i) throw new InputError(`Stooq only supports daily, weekly and monthly data (got ${req.timeframe})`);
    const symbol = req.symbol.trim().toLowerCase();
    const text = await upstreamText(PROVIDER, `https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=${i}`, ctx);
    if (/no data/i.test(text.slice(0, 200))) {
      throw new NotFoundError(`Stooq has no data for "${req.symbol}". Try e.g. aapl.us, ^spx, btcusd.`);
    }
    if (/<!doctype html|<html|requires JavaScript|page you requested/i.test(text.slice(0, 400))) {
      throw new UpstreamError(
        PROVIDER,
        'stooq.com',
        200,
        '',
        "Stooq's bot protection is challenging this server's IP (common on cloud/VPS IPs). " +
          'Use Binance or Yahoo Finance from this machine, or import CSV files — CSV charting works fully offline.',
      );
    }
    const candles = parseStooqCsv(text);
    if (candles.length === 0) throw new UpstreamError(PROVIDER, 'stooq.com', 200, '', `Stooq: could not parse the CSV for "${req.symbol}".`);
    candles.sort((a, b) => a.time - b.time);
    return candles.slice(-req.bars);
  },
};
