/**
 * Hyperliquid in the real formats: `POST /info` (`meta`, `spotMeta`,
 * `candleSnapshot`) and the `candle` websocket subscription. The spot token
 * positions differ from their `index` on purpose, like the real list.
 */
import { bars, barAt, TIMEFRAME_SECONDS } from './data.ts';
import type { Subscription } from './live.ts';

export const HYPERLIQUID_HOST = 'api.hyperliquid.xyz';

const PERPS = ['BTC', 'ETH', 'SOL', 'HYPE', 'XRP', 'kPEPE'];

const SPOT_TOKENS = [
  { name: 'HYPE', index: 150 },
  { name: 'USDC', index: 0 },
  { name: 'PURR', index: 1 },
  { name: 'UBTC', index: 142 },
];

const SPOT_PAIRS = [
  { name: 'PURR/USDC', tokens: [1, 0], index: 0 },
  { name: '@107', tokens: [150, 0], index: 107 },
  { name: '@142', tokens: [142, 0], index: 142 },
];

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** The reply to one `/info` request body. */
export function hyperliquidInfo(rawBody: string, nowSec: number): { status: number; body: unknown } {
  let req: { type?: string; req?: { coin?: string; interval?: string; startTime?: number; endTime?: number } };
  try {
    req = JSON.parse(rawBody);
  } catch {
    return { status: 422, body: null };
  }
  if (req.type === 'meta') {
    return {
      status: 200,
      body: { universe: [...PERPS.map((name) => ({ name, szDecimals: 3, maxLeverage: 20 })), { name: 'MATIC', szDecimals: 1, maxLeverage: 20, isDelisted: true }] },
    };
  }
  if (req.type === 'spotMeta') return { status: 200, body: { tokens: SPOT_TOKENS, universe: SPOT_PAIRS } };
  if (req.type === 'candleSnapshot' && req.req?.coin) {
    const { coin, interval = '' } = req.req;
    const step = TIMEFRAME_SECONDS[interval];
    const known = PERPS.includes(coin) || SPOT_PAIRS.some((p) => p.name === coin);
    if (!step || !known) return { status: 500, body: null }; // like the real service for a wrong coin
    const start = num(req.req.startTime);
    const end = num(req.req.endTime);
    const rows = bars(coin, { step, from: start === undefined ? undefined : Math.ceil(start / 1000), to: end === undefined ? undefined : Math.floor(end / 1000), limit: 5000, nowSec });
    return {
      status: 200,
      body: rows.map((b) => ({ t: b.time * 1000, T: b.time * 1000 + step * 1000 - 1, s: coin, i: interval, o: String(b.open), c: String(b.close), h: String(b.high), l: String(b.low), v: String(b.volume), n: 10 })),
    };
  }
  return { status: 422, body: null };
}

/** `{method:'subscribe', subscription:{type:'candle', coin, interval}}`. */
export function hyperliquidSubscription(msg: unknown): Subscription | null {
  const m = msg as { method?: string; subscription?: { type?: string; coin?: string; interval?: string } };
  const sub = m?.method === 'subscribe' ? m.subscription : undefined;
  const step = sub?.interval ? TIMEFRAME_SECONDS[sub.interval] : undefined;
  if (sub?.type !== 'candle' || !sub.coin || !step) return null;
  const coin = sub.coin;
  return {
    symbol: coin,
    step,
    frame(nowSec) {
      const b = barAt(coin, Math.floor(nowSec / step) * step, step, nowSec);
      const data = { t: b.time * 1000, T: b.time * 1000 + step * 1000 - 1, s: coin, i: sub.interval, o: String(b.open), c: String(b.close), h: String(b.high), l: String(b.low), v: String(b.volume), n: 10 };
      return JSON.stringify({ channel: 'candle', data });
    },
  };
}

export const hyperliquidAck = (msg: unknown): string => JSON.stringify({ channel: 'subscriptionResponse', data: msg });
