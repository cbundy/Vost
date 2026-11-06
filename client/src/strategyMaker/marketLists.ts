import type { MarketList } from '../../../shared/marketLists.ts';

/** The lists the market search offers (`GET /api/market-lists`), or the text of why they could not be read. */
export async function fetchMarketLists(signal?: AbortSignal): Promise<{ lists: MarketList[] } | { error: string }> {
  try {
    const res = await fetch('/api/market-lists', { signal });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      return { error: typeof body?.error === 'string' && body.error ? body.error : `HTTP ${res.status}` };
    }
    const body = (await res.json()) as unknown;
    const lists = Array.isArray(body) ? body : (body as { lists?: unknown } | null)?.lists;
    if (!Array.isArray(lists)) return { error: 'The server sent lists in a shape this page cannot read.' };
    return { lists: lists as MarketList[] };
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw e;
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
