/**
 * Provider registry. The remote providers are built from the shared catalog
 * (`shared/providerCatalog.ts`) and read their data from the Vost server
 * through ./api.ts; the demo provider runs entirely in the browser.
 *
 * Live candles come from the server's `/api/live` stream (../live.ts), never
 * straight from an exchange.
 *
 * To add a data source: write a server adapter in server/providers/, add a
 * catalog entry, and (for live candles) its feed in server/live/feeds.ts. See
 * CONTRIBUTING.md.
 */
import { PROVIDER_CATALOG } from '../../../../shared/providerCatalog.ts';
import type { ProviderInfo } from '../../../../shared/market.ts';
import { fetchHistoryApi, listSymbolsApi, searchSymbolsApi } from './api';
import { demoProvider } from './demo';
import { startLiveApi } from '../live';
import type { DataProvider } from './http';

function remoteProvider(info: ProviderInfo): DataProvider {
  const provider: DataProvider = {
    id: info.id,
    name: info.name,
    description: info.description,
    supportsLive: info.supportsLive,
    timeframes: info.timeframes,
    defaultTimeframe: info.defaultTimeframe,
    defaultSymbol: info.defaultSymbol,
    popularSymbols: info.popularSymbols,
    fetchHistory: (req, signal) => fetchHistoryApi(info.id, req, signal),
  };
  if (info.hasSearch) provider.searchSymbols = (query, signal) => searchSymbolsApi(info.id, query, signal);
  if (info.hasSymbolList) provider.listSymbols = (signal) => listSymbolsApi(info.id, signal);
  if (info.supportsLive) provider.startLive = (opts) => startLiveApi(info.id, opts);
  return provider;
}

const remoteProviders = PROVIDER_CATALOG.map(remoteProvider);

export const providers: DataProvider[] = [...remoteProviders, demoProvider];

const fallbackProvider = providers[0];

export function getProvider(id: string): DataProvider {
  return providers.find((p) => p.id === id) ?? fallbackProvider;
}

export * from './http';
export { demoProvider };
