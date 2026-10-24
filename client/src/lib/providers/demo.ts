/**
 * Synthetic offline dataset — a deterministic random walk with volatility
 * clustering. Great for trying charts and backtests with zero network access.
 */
import type { Candle, Timeframe } from '../../types';
import type { DataProvider, HistoryRequest, SymbolSuggestion } from './http';

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TF_SECONDS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1h': 3600,
  '4h': 14400,
  '1d': 86400,
  '1w': 604800,
  '1M': 2592000,
};

export function generateDemoCandles(opts: {
  bars?: number;
  timeframe?: Timeframe;
  seed?: number;
  startPrice?: number;
}): Candle[] {
  const bars = Math.max(50, Math.min(opts.bars ?? 2000, 100000));
  const tf = opts.timeframe ?? '1d';
  const step = TF_SECONDS[tf];
  const rand = mulberry32(opts.seed ?? 1337);
  const now = Math.floor(Date.now() / 1000);
  const end = Math.floor(now / step) * step;
  let price = opts.startPrice ?? 100;
  let vol = 0.012;
  const candles: Candle[] = [];

  for (let i = 0; i < bars; i++) {
    const t = end - (bars - 1 - i) * step;
    // Drift cycles slowly over time (trending / ranging regimes) + vol clustering.
    const drift = Math.sin(i / 90) * 0.00025 + Math.sin(i / 330) * 0.0004;
    const shock = (rand() - 0.5) * 2;
    if (rand() < 0.04) vol = Math.max(0.004, Math.min(0.06, vol * (0.8 + rand() * 0.6)));
    const ret = drift + shock * vol;
    const open = price;
    const close = Math.max(0.01, open * (1 + ret));
    const wick = Math.abs(shock) * vol * open * (0.6 + rand() * 1.8);
    const high = Math.max(open, close) + wick * rand();
    const low = Math.min(open, close) - wick * rand();
    const volume = Math.round((800 + rand() * 1200) * (1 + Math.abs(ret) * 90) * (tf === '1d' ? 10 : 1));
    candles.push({
      time: t,
      open: round(open),
      high: round(Math.max(high, open, close)),
      low: round(Math.max(0.01, Math.min(low, open, close))),
      close: round(close),
      volume,
    });
    price = close;
  }
  return candles;
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

const DEMO_SYMBOLS: SymbolSuggestion[] = [
  { symbol: 'DEMO', label: 'Synthetic uptrend', type: 'demo' },
  { symbol: 'DEMO-BEAR', label: 'Synthetic downtrend', type: 'demo' },
  { symbol: 'DEMO-CHOP', label: 'Synthetic range', type: 'demo' },
];

export const demoProvider: DataProvider = {
  id: 'demo',
  name: 'Demo (offline)',
  description: 'Deterministic synthetic candles — no network required. Perfect for testing.',
  offline: true,
  timeframes: ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'],
  defaultTimeframe: '1d',
  defaultSymbol: 'DEMO',
  popularSymbols: DEMO_SYMBOLS,

  async listSymbols(): Promise<SymbolSuggestion[]> {
    return DEMO_SYMBOLS;
  },

  async fetchHistory(req: HistoryRequest): Promise<Candle[]> {
    const seedMap: Record<string, number> = { DEMO: 1337, 'DEMO-BEAR': 4242, 'DEMO-CHOP': 2024 };
    const seed = seedMap[req.symbol.toUpperCase()] ?? 1337;
    const candles = generateDemoCandles({ bars: req.bars, timeframe: req.timeframe, seed });
    const sym = req.symbol.toUpperCase();
    if (sym === 'DEMO-BEAR') {
      // Mirror the series around its last close to get an exact downtrend
      // (highs and lows swap under mirroring).
      const last = candles[candles.length - 1].close;
      const m = (p: number): number => round(Math.max(0.01, last * 2 - p));
      return candles.map((c) => ({
        time: c.time,
        open: m(c.open),
        high: m(c.low),
        low: m(c.high),
        close: m(c.close),
        volume: c.volume,
      }));
    }
    return candles;
  },
};
