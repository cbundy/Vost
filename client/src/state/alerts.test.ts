import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Alert } from '../../../shared/alerts.ts';
import { RETRY_MAX_MS, RETRY_MIN_MS, useAlerts, type SourceLike } from './alerts';

const alert = (over: Partial<Alert> = {}): Alert => ({
  id: 'a1', provider: 'binance', symbol: 'BTCUSDT', condition: 'crossing-up', level: 65000, note: '', createdAt: 1,
  status: 'triggered', lastPrice: null, triggeredAt: 1000, triggerPrice: 65012, telegram: 'sent', ...over,
});

class FakeSource implements SourceLike {
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(ev: Event) => void>>();
  addEventListener(type: string, fn: (ev: Event) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  emit(type: string, data: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) } as unknown as Event);
  }
  fail(readyState: 0 | 2): void {
    this.readyState = readyState;
    this.onerror?.(new Event('error'));
  }
}

function harness(opts: { chimeResult?: boolean; seen?: string[] } = {}) {
  const sources: FakeSource[] = [];
  const timers: Array<{ fn: () => void; ms: number; cleared: boolean }> = [];
  const messages: Array<[string, string, string]> = [];
  let chimes = 0;
  let stored = opts.seen ?? [];
  const deps = {
    eventSource: () => {
      const s = new FakeSource();
      sources.push(s);
      return s;
    },
    setTimeout: (fn: () => void, ms: number) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (h: unknown) => void ((h as { cleared: boolean }).cleared = true),
    chime: () => {
      chimes++;
      return opts.chimeResult ?? true;
    },
    loadSeen: () => stored,
    saveSeen: (k: string[]) => void (stored = k),
    pushMessage: (s: string, sev: string, t: string) => void messages.push([s, sev, t]),
    fetchList: async () => ({ alerts: [], telegram: { configured: true } }),
  };
  return { deps, sources, timers, messages, chimes: () => chimes, seen: () => stored };
}

beforeEach(() => useAlerts.setState({ alerts: [], popups: [], sound: true, connected: false, telegramConfigured: null }));
afterEach(() => useAlerts.getState().stop());

describe('alerts store', () => {
  it('announces a triggered event once, even when it repeats or arrives in a list', () => {
    const h = harness();
    useAlerts.getState().start(h.deps);
    const src = h.sources[0];
    src.open();
    src.emit('triggered', alert());
    src.emit('triggered', alert());
    src.emit('alerts', { alerts: [alert()] });
    expect(h.messages).toEqual([['Alerts', 'warning', 'BTCUSDT crossed up 65,000 (at 65,012)']]);
    expect(useAlerts.getState().popups).toHaveLength(1);
    expect(h.chimes()).toBe(1);
    expect(h.seen()).toEqual(['a1:1000']);
  });

  it('announces unseen triggered alerts in the first list, and not again after a reconnect', () => {
    const h = harness({ seen: ['old:5'] });
    useAlerts.getState().start(h.deps);
    h.sources[0].open();
    h.sources[0].emit('alerts', { alerts: [alert(), alert({ id: 'b', status: 'active', triggeredAt: null })] });
    expect(h.messages).toHaveLength(1);
    h.sources[0].fail(2);
    h.timers[0].fn();
    h.sources[1].open();
    h.sources[1].emit('alerts', { alerts: [alert()] });
    expect(h.messages).toHaveLength(1);
    expect(h.seen()).toEqual(['a1:1000']); // pruned: "old" no longer exists
  });

  it('announces an alert already seen in an earlier visit zero times', () => {
    const h = harness({ seen: ['a1:1000'] });
    useAlerts.getState().start(h.deps);
    h.sources[0].emit('alerts', { alerts: [alert()] });
    expect(h.messages).toHaveLength(0);
    expect(useAlerts.getState().popups).toHaveLength(0);
  });

  it('announces a re-armed alert that fires again under the same id', () => {
    const h = harness();
    useAlerts.getState().start(h.deps);
    h.sources[0].emit('triggered', alert({ triggeredAt: 1000 }));
    h.sources[0].emit('alerts', { alerts: [alert({ status: 'active', triggeredAt: null })] });
    h.sources[0].emit('triggered', alert({ triggeredAt: 2000 }));
    expect(h.messages).toHaveLength(2);
    expect(useAlerts.getState().popups.map((p) => p.key)).toEqual(['a1:2000', 'a1:1000']);
  });

  it('reopens a CLOSED source after a growing backoff that resets on open', () => {
    const h = harness();
    useAlerts.getState().start(h.deps);
    h.sources[0].fail(0); // CONNECTING: the browser retries itself
    expect(h.timers).toHaveLength(0);
    h.sources[0].fail(2);
    expect(h.sources[0].closed).toBe(true);
    expect(h.timers.map((t) => t.ms)).toEqual([RETRY_MIN_MS]);
    h.timers[0].fn();
    h.sources[1].fail(2);
    h.timers[1].fn();
    h.sources[2].fail(2);
    expect(h.timers.map((t) => t.ms)).toEqual([1000, 2000, 4000]);
    h.timers[2].fn();
    h.sources[3].open();
    h.sources[3].fail(2);
    expect(h.timers.at(-1)?.ms).toBe(RETRY_MIN_MS);
    for (let i = 0; i < 8; i++) {
      h.timers.at(-1)!.fn();
      h.sources.at(-1)!.fail(2);
    }
    expect(h.timers.at(-1)?.ms).toBe(RETRY_MAX_MS);
  });

  it('plays no chime with sound off, and a failed chime still leaves popup and inbox line', () => {
    const off = harness();
    useAlerts.getState().start(off.deps);
    useAlerts.setState({ sound: false });
    off.sources[0].emit('triggered', alert());
    expect(off.chimes()).toBe(0);
    expect(off.messages).toHaveLength(1);

    const blocked = harness({ chimeResult: false });
    useAlerts.setState({ sound: true, popups: [] });
    useAlerts.getState().start(blocked.deps);
    blocked.sources[0].emit('triggered', alert({ id: 'z' }));
    expect(blocked.chimes()).toBe(1);
    expect(blocked.messages).toHaveLength(1);
    expect(useAlerts.getState().popups).toHaveLength(1);
  });

  it('dismisses one popup', () => {
    const h = harness();
    useAlerts.getState().start(h.deps);
    h.sources[0].emit('triggered', alert({ id: 'a' }));
    h.sources[0].emit('triggered', alert({ id: 'b' }));
    useAlerts.getState().dismissPopup('a:1000');
    expect(useAlerts.getState().popups.map((p) => p.alert.id)).toEqual(['b']);
  });

  it('keeps the list, the Telegram flag and API upserts', async () => {
    const h = harness();
    useAlerts.getState().start(h.deps);
    h.sources[0].open();
    h.sources[0].emit('alerts', { alerts: [alert({ status: 'active', triggeredAt: null })] });
    await Promise.resolve();
    await Promise.resolve();
    expect(useAlerts.getState().telegramConfigured).toBe(true);
    useAlerts.getState().upsert(alert({ id: 'n', status: 'active', triggeredAt: null }));
    expect(useAlerts.getState().alerts.map((a) => a.id)).toEqual(['a1', 'n']);
    useAlerts.getState().remove('a1');
    expect(useAlerts.getState().alerts.map((a) => a.id)).toEqual(['n']);
  });

  it('stop() closes the source and clears the timer', () => {
    const h = harness();
    useAlerts.getState().start(h.deps);
    h.sources[0].fail(2);
    useAlerts.getState().stop();
    expect(h.timers[0].cleared).toBe(true);
    const open = harness();
    useAlerts.getState().start(open.deps);
    useAlerts.getState().stop();
    expect(open.sources[0].closed).toBe(true);
  });
});
