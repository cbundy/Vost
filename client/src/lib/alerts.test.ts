import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Alert } from '../../../shared/alerts.ts';
import { NETWORK_ERROR, SEEN_CAP, addSeen, announcementText, conditionLabel, createAlert, loadSeen, pruneSeen, seenKey, unseenTriggers } from './alerts';

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 'a1', provider: 'binance', symbol: 'BTCUSDT', condition: 'crossing-up', level: 65000, note: '', createdAt: 1,
  status: 'active', lastPrice: null, triggeredAt: null, triggerPrice: null, ...over,
});
const fired = (over: Partial<Alert> = {}): Alert => alert({ status: 'triggered', triggeredAt: 1000, triggerPrice: 65012, telegram: 'sent', ...over });

describe('unseenTriggers', () => {
  it('returns triggered alerts whose firing is not seen', () => {
    const a = fired({ id: 'a' });
    const b = fired({ id: 'b' });
    expect(unseenTriggers([a, b], [seenKey(a)])).toEqual([b]);
    expect(unseenTriggers([a, b], new Set([seenKey(a), seenKey(b)]))).toEqual([]);
  });
  it('ignores active alerts', () => {
    expect(unseenTriggers([alert()], [])).toEqual([]);
  });
  it('ignores seen keys of deleted alerts', () => {
    expect(unseenTriggers([fired({ id: 'b' })], ['gone:1000'])).toHaveLength(1);
  });
  it('counts a re-armed alert that fired again as unseen', () => {
    const first = fired({ triggeredAt: 1000 });
    const again = fired({ triggeredAt: 2000 });
    expect(unseenTriggers([again], [seenKey(first)])).toEqual([again]);
  });
});

describe('seen record', () => {
  it('is bounded at its cap, newest kept', () => {
    const keys = Array.from({ length: SEEN_CAP + 20 }, (_, i) => `a${i}:1`);
    const out = addSeen([], keys);
    expect(out).toHaveLength(SEEN_CAP);
    expect(out.at(-1)).toBe(keys.at(-1));
    expect(out[0]).toBe('a20:1');
    expect(addSeen(['x:1', 'y:1'], ['x:1'])).toEqual(['y:1', 'x:1']);
  });
  it('is pruned to alerts that still exist', () => {
    expect(pruneSeen(['a:1', 'b:2', 'a:3'], [alert({ id: 'a' })])).toEqual(['a:1', 'a:3']);
  });
  it('reads a malformed stored value as empty', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    try {
      store.set('vost.alerts.seen.v1', '{"not":"an array"}');
      expect(loadSeen()).toEqual([]);
      store.set('vost.alerts.seen.v1', 'not json');
      expect(loadSeen()).toEqual([]);
      store.set('vost.alerts.seen.v1', '["a:1", 5, null]');
      expect(loadSeen()).toEqual(['a:1']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('labels', () => {
  it('names the conditions', () => {
    expect(conditionLabel('crossing-up')).toBe('Crossing up');
    expect(conditionLabel('crossing-down')).toBe('Crossing down');
    expect(conditionLabel('crossing')).toBe('Crossing');
  });
  it('words an announcement with the price and the note', () => {
    expect(announcementText(fired())).toBe('BTCUSDT crossed up 65,000 (at 65,012)');
    expect(announcementText(fired({ condition: 'crossing-down', note: 'watch it' }))).toBe('BTCUSDT crossed down 65,000 (at 65,012) - watch it');
  });
});

describe('API errors', () => {
  afterEach(() => vi.unstubAllGlobals());
  it("shows the API's own error text", async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'level must be a number' }), { status: 400 }));
    await expect(createAlert({ provider: 'binance', symbol: 'X', condition: 'crossing', level: 1 })).rejects.toThrow('level must be a number');
  });
  it('says plainly when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(createAlert({ provider: 'binance', symbol: 'X', condition: 'crossing', level: 1 })).rejects.toThrow(NETWORK_ERROR);
  });
});
