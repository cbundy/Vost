/**
 * The Telegram notifier for fired alerts: reads the two settings, words the
 * message and posts it to the Bot API. The bot token is a secret: it is in the
 * request URL, so every log line, reason and error text this file produces
 * goes through `redact`.
 */
import type { Alert } from '../../shared/alerts.ts';
import { catalogEntry } from '../../shared/providerCatalog.ts';
import { RETRY_DELAYS_MS, TIMEOUT_MS, type FetchFn } from '../providers/upstream.ts';
import { upstreamUrl } from '../testUpstream.ts';

export const TOKEN_VAR = 'VOST_TELEGRAM_BOT_TOKEN';
export const CHAT_VAR = 'VOST_TELEGRAM_CHAT_ID';
const MAX_RETRY_AFTER_S = 30;
const MAX_REASON = 200;

export interface TelegramConfig {
  token: string;
  chatId: string;
}

export type SendResult = { ok: true } | { ok: false; reason: string };

export interface Telegram {
  readonly configured: boolean;
  send(text: string): Promise<SendResult>;
}

/** Both settings, or null (Telegram off). Logs one warning, naming the missing variable, when only one is set. */
export function readTelegramConfig(env: Record<string, string | undefined>, log: (line: string) => void = () => undefined): TelegramConfig | null {
  const token = (env[TOKEN_VAR] ?? '').trim();
  const chatId = (env[CHAT_VAR] ?? '').trim();
  if (token && chatId) return { token, chatId };
  if (token) log(`[alerts] ${CHAT_VAR} is not set: Telegram is off`);
  else if (chatId) log(`[alerts] ${TOKEN_VAR} is not set: Telegram is off`);
  return null;
}

/** Replaces every occurrence of the token, raw and URL-encoded, with `<token>`. */
export function redactToken(text: string, token: string): string {
  if (!token) return text;
  let out = text;
  for (const form of new Set([token, encodeURIComponent(token), encodeURI(token)])) out = out.split(form).join('<token>');
  return out;
}

const fmt = (n: number): string => n.toLocaleString('en-US', { maximumFractionDigits: 20 });

/** e.g. `Vost alert: BTCUSDT (Binance) crossed up 65,000 - now 65,012.5. Note: take profit` */
export function alertMessage(alert: Alert): string {
  const verb = alert.condition === 'crossing-up' ? 'crossed up' : alert.condition === 'crossing-down' ? 'crossed down' : 'crossed';
  const provider = catalogEntry(alert.provider)?.name ?? alert.provider;
  const now = alert.triggerPrice === null ? '' : ` - now ${fmt(alert.triggerPrice)}`;
  const note = alert.note.trim() ? ` Note: ${alert.note.trim()}` : '';
  return `Vost alert: ${alert.symbol} (${provider}) ${verb} ${fmt(alert.level)}${now}.${note}`;
}

export interface TelegramDeps {
  config: TelegramConfig | null;
  fetch?: FetchFn;
  log?: (line: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

const OFF: Telegram = { configured: false, send: async () => ({ ok: false, reason: 'Telegram is not configured' }) };

interface BotReply {
  ok?: boolean;
  description?: string;
  parameters?: { retry_after?: number };
}

async function readReply(res: Response): Promise<BotReply | null> {
  try {
    const body: unknown = await res.json();
    return body && typeof body === 'object' ? (body as BotReply) : null;
  } catch {
    return null;
  }
}

export function createTelegram(deps: TelegramDeps): Telegram {
  const { config } = deps;
  if (!config) return OFF;
  const doFetch = deps.fetch ?? globalThis.fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const redact = (text: string): string => redactToken(text, config.token);
  const clip = (text: string): string => redact(text).slice(0, MAX_REASON);
  const url = upstreamUrl(`https://api.telegram.org/bot${config.token}/sendMessage`);

  type Attempt = { done: SendResult } | { retry: string; waitMs?: number };

  async function attempt(text: string): Promise<Attempt> {
    let res: Response;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: config!.chatId, text }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const name = (err as { name?: string }).name;
      const timedOut = name === 'TimeoutError' || name === 'AbortError';
      return { retry: timedOut ? 'timed out' : clip(`network error: ${err instanceof Error ? err.message : String(err)}`) };
    }
    const data = await readReply(res);
    const reason = clip(typeof data?.description === 'string' && data.description ? data.description : `HTTP ${res.status}`);
    if (res.status === 429) {
      const after = Number(data?.parameters?.retry_after);
      return { retry: reason, waitMs: Number.isFinite(after) && after >= 0 ? Math.min(after, MAX_RETRY_AFTER_S) * 1000 : undefined };
    }
    if (res.status >= 500) return { retry: reason };
    if (res.status >= 200 && res.status < 300) return { done: data?.ok === true ? { ok: true } : { ok: false, reason: clip(typeof data?.description === 'string' && data.description ? data.description : 'Telegram refused the message') } };
    return { done: { ok: false, reason } };
  }

  return {
    configured: true,
    async send(text) {
      let last = 'failed';
      for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
        const r = await attempt(text);
        if ('done' in r) return r.done;
        last = r.retry;
        const next = i + 1;
        if (next < RETRY_DELAYS_MS.length) {
          const wait = r.waitMs ?? RETRY_DELAYS_MS[next];
          if (wait > 0) await sleep(wait);
        }
      }
      return { ok: false, reason: clip(last) };
    },
  };
}
