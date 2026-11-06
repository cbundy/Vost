/** The offline demo markets have no server route: a market search loads them from the generator, wherever it runs. */
import { MAX_BARS } from '../../../../shared/market.ts';
import { demoProvider } from '../../lib/providers/demo';
import type { SweepLoad } from './types';

/** `load` for every market but the demo ones, which are generated (no network, the same candles on both sides). */
export const withDemo =
  (load: SweepLoad): SweepLoad =>
  (market, timeframe, signal) =>
    market.provider === 'demo' ? demoProvider.fetchHistory({ symbol: market.symbol, timeframe, bars: MAX_BARS }) : load(market, timeframe, signal);
