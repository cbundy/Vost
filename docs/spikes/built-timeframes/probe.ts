/**
 * One-off probe: builds a timeframe from a lower native one with the real builder and compares it with the
 * exchange's own bars of that timeframe, on live data. Run: `node docs/spikes/built-timeframes/probe.ts`.
 * It exits 0 and prints one line per case and every differing bar. The newest bar (still forming) is skipped.
 */
import type { Candle, Timeframe } from '../../../shared/market.ts';
import { binanceAdapter } from '../../../server/providers/binance.ts';
import { krakenAdapter } from '../../../server/providers/kraken.ts';
import { yahooAdapter } from '../../../server/providers/yahoo.ts';
import { builtHistory } from '../../../server/providers/built.ts';
import { createSymbolCache } from '../../../server/providers/symbolCache.ts';
import type { ProviderAdapter } from '../../../server/providers/types.ts';
import type { Calendar } from '../../../shared/timeframes.ts';

const ctx = { fetch: globalThis.fetch, symbols: createSymbolCache() };

async function compare(label: string, adapter: ProviderAdapter, symbol: string, target: Timeframe, fakeNative: Timeframe[], bars: number): Promise<void> {
  const native = await adapter.history(ctx, { symbol, timeframe: target, bars });
  const built = await builtHistory(
    { fetchBase: (req, onCalendar: (c: Calendar) => void) => adapter.history({ ...ctx, onCalendar }, req) },
    fakeNative,
    { symbol, timeframe: target, bars },
  );
  const byTime = new Map<number, Candle>(native.map((c) => [c.time, c]));
  const newest = native[native.length - 1].time;
  let compared = 0;
  const diffs: string[] = [];
  for (const b of built) {
    if (b.time >= newest) continue;
    const n = byTime.get(b.time);
    if (!n) {
      diffs.push(`${new Date(b.time * 1000).toISOString()} built bar has no native bar at that time`);
      continue;
    }
    compared++;
    for (const k of ['open', 'high', 'low', 'close', 'volume'] as const) {
      const tol = k === 'volume' ? Math.abs(n[k]) * 1e-6 : 1e-9 * Math.max(1, Math.abs(n[k]));
      if (Math.abs(b[k] - n[k]) > tol) diffs.push(`${new Date(b.time * 1000).toISOString()} ${k}: built ${b[k]} native ${n[k]}`);
    }
  }
  let maxPriceDiff = 0;
  for (const b of built) {
    const n = byTime.get(b.time);
    if (!n || b.time >= newest) continue;
    for (const k of ['open', 'high', 'low', 'close'] as const) maxPriceDiff = Math.max(maxPriceDiff, Math.abs(b[k] - n[k]) / n[k]);
  }
  console.log(`${label}: ${built.length} built bars, ${compared} lined up with the ${native.length} native bars, ${diffs.length} differences, largest price difference ${(maxPriceDiff * 100).toFixed(3)}%`);
  for (const d of diffs.slice(0, 5)) console.log(`  ${d}`);
}

const BINANCE_LOW: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '1d'];
await compare('Binance BTCUSDT 4h from 1h', binanceAdapter, 'BTCUSDT', '4h', ['1h'], 300);
await compare('Binance BTCUSDT 1w from 1d', binanceAdapter, 'BTCUSDT', '1w', BINANCE_LOW, 60);
await compare('Binance BTCUSDT 1M from 1d', binanceAdapter, 'BTCUSDT', '1M', BINANCE_LOW, 24);
// Kraken's own weekly bars start on Thursday (epoch weeks), built weeks on Monday: none line up, by design (Kraken 1w is native and never built).
await compare('Kraken XBTUSD 1w from 1d', krakenAdapter, 'XBTUSD', '1w', ['1d'], 40);
// Yahoo's daily bar includes the opening and closing auction prints and full consolidated volume, the hourly bars do not: cents and volume differ.
await compare('Yahoo AAPL 1d from 1h', yahooAdapter, 'AAPL', '1d', ['1h'], 60);
