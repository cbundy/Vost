/**
 * Stooq — free downloadable historical data (stocks, indices, forex, crypto).
 * Returns plain CSV, no key required. Needs the proxy for CORS.
 */
import Papa from 'papaparse';
import type { Candle, Timeframe } from '../../types';
import { matchSymbols } from './symbolMatch';
import { STOOQ_SYMBOLS } from './stooqSymbols';
import { fetchText, type DataProvider, type HistoryRequest, type SymbolSuggestion } from './http';

const STOOQ_INTERVALS: Partial<Record<Timeframe, string>> = {
  '1d': 'd',
  '1w': 'w',
  '1M': 'm',
};

export const stooqProvider: DataProvider = {
  id: 'stooq',
  name: 'Stooq',
  description: 'Free historical data (stocks / indices / FX / crypto) downloadable as CSV. No key needed.',
  needsProxy: true,
  timeframes: ['1d', '1w', '1M'],
  defaultTimeframe: '1d',
  defaultSymbol: 'aapl.us',
  popularSymbols: [
    { symbol: 'aapl.us', label: 'Apple (US)', exchange: 'US', type: 'stock' },
    { symbol: 'msft.us', label: 'Microsoft (US)', exchange: 'US', type: 'stock' },
    { symbol: 'tsla.us', label: 'Tesla (US)', exchange: 'US', type: 'stock' },
    { symbol: 'spy.us', label: 'SPDR S&P 500 ETF', exchange: 'US', type: 'etf' },
    { symbol: '^spx', label: 'S&P 500 Index', exchange: 'US', type: 'index' },
    { symbol: '^ndq', label: 'Nasdaq 100 Index', exchange: 'US', type: 'index' },
    { symbol: 'btcusd', label: 'Bitcoin / USD', exchange: 'CRYPT', type: 'crypto' },
    { symbol: 'ethusd', label: 'Ethereum / USD', exchange: 'CRYPT', type: 'crypto' },
    { symbol: 'eurusd', label: 'EUR / USD', exchange: 'FX', type: 'forex' },
    { symbol: 'usdjpy', label: 'USD / JPY', exchange: 'FX', type: 'forex' },
    { symbol: 'xauusd', label: 'Gold / USD', exchange: 'XAU', type: 'commodity' },
  ],

  async listSymbols(): Promise<SymbolSuggestion[]> {
    return STOOQ_SYMBOLS;
  },

  async searchSymbols(query: string): Promise<SymbolSuggestion[]> {
    if (!query.trim()) return STOOQ_SYMBOLS;
    return matchSymbols(STOOQ_SYMBOLS, query);
  },

  async fetchHistory(req: HistoryRequest, signal?: AbortSignal): Promise<Candle[]> {
    const i = STOOQ_INTERVALS[req.timeframe];
    if (!i) throw new Error(`Stooq only supports daily, weekly and monthly data (got ${req.timeframe})`);
    const symbol = req.symbol.trim().toLowerCase();
    const text = await fetchText(`https://stooq.com/q/d/l/?s=${encodeURIComponent(symbol)}&i=${i}`, { signal });
    if (/no data/i.test(text.slice(0, 200))) {
      throw new Error(`Stooq has no data for "${req.symbol}". Try e.g. aapl.us, ^spx, btcusd.`);
    }
    if (/<!doctype html|<html|requires JavaScript|page you requested/i.test(text.slice(0, 400))) {
      throw new Error(
        "Stooq's bot protection is challenging this server's IP (common on cloud/VPS IPs). " +
          'Use Binance or Yahoo Finance from this machine, or import CSV files — CSV charting works fully offline.',
      );
    }
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim().toLowerCase(),
    });
    const candles: Candle[] = [];
    for (const row of parsed.data) {
      const time = Date.parse(row.date ?? '');
      const open = Number(row.open);
      const high = Number(row.high);
      const low = Number(row.low);
      const close = Number(row.close);
      const volume = Number(row.volume ?? 0);
      if (!Number.isFinite(time) || !Number.isFinite(close)) continue;
      candles.push({
        time: Math.floor(time / 1000),
        open,
        high,
        low,
        close,
        volume: Number.isFinite(volume) ? volume : 0,
      });
    }
    if (candles.length === 0) throw new Error(`Could not parse Stooq CSV for "${req.symbol}".`);
    candles.sort((a, b) => a.time - b.time);
    return candles.slice(-req.bars);
  },
};
