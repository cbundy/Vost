/** The REST adapters by provider id; every id in the catalog has one. */
import { PROVIDER_CATALOG } from '../../shared/providerCatalog.ts';
import { binanceAdapter } from './binance.ts';
import { bybitAdapter } from './bybit.ts';
import { coinbaseAdapter } from './coinbase.ts';
import { krakenAdapter } from './kraken.ts';
import { okxAdapter } from './okx.ts';
import { stooqAdapter } from './stooq.ts';
import type { ProviderAdapter } from './types.ts';
import { yahooAdapter } from './yahoo.ts';

const ADAPTERS: ProviderAdapter[] = [binanceAdapter, coinbaseAdapter, krakenAdapter, bybitAdapter, okxAdapter, yahooAdapter, stooqAdapter];

export const adapters: ReadonlyMap<string, ProviderAdapter> = new Map(ADAPTERS.map((a) => [a.id, a]));

for (const info of PROVIDER_CATALOG) {
  if (!adapters.has(info.id)) throw new Error(`No server adapter for catalog provider "${info.id}"`);
}
