/**
 * Provider registry. To add your own data source, implement `DataProvider`
 * (see ./http.ts) and register it here — the UI picks it up automatically.
 *
 * See docs/STRATEGIES.md and CONTRIBUTING.md for a walkthrough.
 */
import { binanceProvider } from './binance';
import { bybitProvider } from './bybit';
import { coinbaseProvider } from './coinbase';
import { demoProvider } from './demo';
import type { DataProvider } from './http';
import { krakenProvider } from './kraken';
import { okxProvider } from './okx';
import { stooqProvider } from './stooq';
import { yahooProvider } from './yahoo';

export const providers: DataProvider[] = [
  binanceProvider,
  coinbaseProvider,
  krakenProvider,
  bybitProvider,
  okxProvider,
  yahooProvider,   stooqProvider,
  demoProvider,
];

export function getProvider(id: string): DataProvider {
  return providers.find((p) => p.id === id) ?? binanceProvider;
}

export * from './http';
export { binanceProvider, coinbaseProvider, krakenProvider, bybitProvider, okxProvider, yahooProvider, stooqProvider, demoProvider };
