/**
 * Where `request.security` and `request.security_lower_tf` read another symbol from.
 *
 * PineTS drops the exchange prefix of the symbol (`BYBIT:BTCUSDT` -> `BTCUSDT`) before its data source sees it, and
 * answers a request for the chart's own ticker from the chart's data. So the symbol is read here first, in a subclass
 * of `PineTS` that wraps the two functions on the primary run's context, and handed on as a colon-free route id
 * (`bybit~BTCUSDT`) that `createMarketProvider` decodes. The chart's own symbol is left as written.
 *
 * Pinned to PineTS 0.13.0: `PineTS.run` calls the private `_initializeContext`, which builds `context.pine.request`.
 * `installRouting` and `assertHooked` fail with a clear message when either stops being true.
 */
import { PineTS } from 'pinets';
import { PROVIDER_CATALOG } from '../../../../shared/providerCatalog';
import type { CurrencyRates } from './currencyRate';
import { marketIdentity } from './market';
import type { PineMarket } from './types';

/** Provider ids a script may name as a prefix: the catalog's and the browser's demo provider. */
export const PROVIDER_IDS: string[] = [...PROVIDER_CATALOG.map((p) => p.id), 'demo'];

const SEPARATOR = '~';

export interface Route {
  providerId: string;
  symbol: string;
}

/** The colon-free id PineTS hands to the provider for a symbol of `providerId`. */
export function encodeRoute(route: Route): string {
  return `${route.providerId}${SEPARATOR}${route.symbol}`;
}

/** The route an id made by `encodeRoute` stands for, or null for any other id. */
export function decodeRoute(id: unknown): Route | null {
  if (typeof id !== 'string') return null;
  const i = id.indexOf(SEPARATOR);
  if (i <= 0) return null;
  const providerId = id.slice(0, i);
  return PROVIDER_IDS.includes(providerId) && i + 1 < id.length ? { providerId, symbol: id.slice(i + 1) } : null;
}

/** A symbol Vost cannot serve; the run stops with its message. */
export class RoutingError extends Error {}

/** The plain symbol of a TradingView encoded ticker id (`={"session":"extended","symbol":"X"}`). */
function plain(symbol: string): string {
  if (!symbol.startsWith('={')) return symbol;
  try {
    const s = JSON.parse(symbol.slice(1)).symbol;
    return typeof s === 'string' ? s : symbol;
  } catch {
    return symbol;
  }
}

/**
 * The symbol to hand to PineTS for a script's `raw` symbol: unchanged for `""` and for the chart's own symbol (its
 * full id or its bare ticker), else the route id of the provider and symbol. Throws a `RoutingError` for a prefix that
 * is no Vost provider and for a prefix-less other symbol on an imported dataset (which has no provider).
 */
export function routeSymbol(raw: string, market: PineMarket | undefined, fn = 'request.security'): string {
  if (raw === '' || !market) return raw;
  const text = plain(raw);
  const id = marketIdentity(market);
  const colon = text.indexOf(':');
  if (colon < 0 ? text.toUpperCase() === id.ticker.toUpperCase() : text.toUpperCase() === id.tickerid.toUpperCase()) return raw;
  const prefix = colon < 0 ? '' : text.slice(0, colon);
  const symbol = colon < 0 ? text : text.slice(colon + 1);
  if (!symbol) throw new RoutingError(`${fn}: the symbol "${raw}" names no symbol after its prefix`);
  if (!prefix) {
    if (market.dataset) {
      throw new RoutingError(`${fn}: "${raw}" has no provider prefix, and an imported dataset chart can only read a symbol with a provider prefix (for example BINANCE:${symbol}). Vost providers: ${PROVIDER_IDS.join(', ')}`);
    }
    return encodeRoute({ providerId: market.providerId, symbol });
  }
  const providerId = prefix.toLowerCase();
  if (!PROVIDER_IDS.includes(providerId)) {
    throw new RoutingError(`${fn}: unknown data source "${prefix}" in "${raw}". Vost providers: ${PROVIDER_IDS.join(', ')}`);
  }
  return encodeRoute({ providerId, symbol });
}

const isSeries = (v: any): boolean => v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.get === 'function';
/** A trailing named-arguments object (`{ lookahead: ... }`): not a Series, a tuple or one of PineTS's value helpers. */
const isBag = (v: any): boolean => v !== null && typeof v === 'object' && !Array.isArray(v) && !isSeries(v) && !('__value' in v);
/** A `request.param` wrapper `[value, name]`. */
const isParamTuple = (v: any): boolean => Array.isArray(v) && v.length === 2 && typeof v[1] === 'string';

function mapSymbol(v: any, rewrite: (s: string) => string): any {
  if (isParamTuple(v)) return [mapSymbol(v[0], rewrite), v[1]];
  const value = isSeries(v) ? v.get(0) : v;
  return typeof value === 'string' ? rewrite(value) : v;
}

/** `args` of a request call with its symbol (positional, or the `symbol` key of the named-arguments object) rewritten. */
export function rewriteSymbolArg(args: any[], rewrite: (s: string) => string): any[] {
  return args.map((a, i) => {
    if (isBag(a)) return 'symbol' in a ? { ...a, symbol: mapSymbol(a.symbol, rewrite) } : a;
    return i === 0 ? mapSymbol(a, rewrite) : a;
  });
}

export interface Routing {
  market: PineMarket | undefined;
  rates: CurrencyRates | null;
}

const version = 'PineTS 0.13.0';

/** Wraps the request functions of a primary run's context. Throws a clear error when the engine no longer has them. */
export function installRouting(ctx: any, routing: Routing): void {
  const request = ctx?.pine?.request;
  for (const name of ['security', 'security_lower_tf', 'currency_rate']) {
    if (typeof request?.[name] !== 'function') {
      throw new Error(`Vost routes request.${name} to other symbols and found no context.pine.request.${name} in the Pine engine (Vost is pinned to ${version}); other-symbol requests cannot be routed`);
    }
  }
  for (const name of ['security', 'security_lower_tf']) {
    const original = request[name];
    const fn = `request.${name}`;
    request[name] = async (...args: any[]) => original(...rewriteSymbolArg(args, (s) => routeSymbol(s, routing.market, fn)));
  }
  const rate = request.currency_rate;
  request.currency_rate = (...args: any[]) => {
    const value = (a: any) => { const v = isParamTuple(a) ? a[0] : a; return isSeries(v) ? v.get(0) : v; };
    const from = value(args[0]);
    const to = value(args[1]);
    const bag = args.find((a, i) => i >= 2 && isBag(a));
    const ignore = value(args[2] !== undefined && !isBag(args[2]) ? args[2] : bag?.ignore_invalid_currency) === true;
    if (typeof from !== 'string' || typeof to !== 'string' || !from || !to || from.toUpperCase() === to.toUpperCase() || !routing.rates) return rate(...args);
    const openTime = ctx.data?.openTime;
    return routing.rates.rate(from.toUpperCase(), to.toUpperCase(), isSeries(openTime) ? openTime.get(0) : NaN, ignore);
  };
}

/** The Pine engine with routing installed on every primary run. */
export class RoutedPineTS extends PineTS {
  hooked = 0;
  routing: Routing = { market: undefined, rates: null };
}

if (typeof (PineTS.prototype as any)._initializeContext !== 'function') {
  throw new Error(`Vost routes other symbols through PineTS._initializeContext, which the Pine engine no longer has (Vost is pinned to ${version})`);
}
const initializeContext = (PineTS.prototype as any)._initializeContext;
Object.defineProperty(RoutedPineTS.prototype, '_initializeContext', {
  configurable: true,
  writable: true,
  value: function (this: RoutedPineTS, ...args: any[]) {
    const ctx = initializeContext.apply(this, args);
    // A secondary context (another symbol's run) answers its requests with the expression itself: only the primary routes.
    if (!ctx.isSecondaryContext) {
      installRouting(ctx, this.routing);
      this.hooked++;
    }
    return ctx;
  },
});

/** Throws when a finished run never went through the routing hook (the engine stopped calling it). */
export function assertHooked(pine: RoutedPineTS): void {
  if (pine.hooked === 0) {
    throw new Error(`Vost's other-symbol routing was never installed: the Pine engine did not call PineTS._initializeContext on the run (Vost is pinned to ${version})`);
  }
}
