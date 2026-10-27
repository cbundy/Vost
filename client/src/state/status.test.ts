import { afterEach, describe, expect, it } from 'vitest';
import type { StatusResponse } from '../../../shared/status.ts';
import { POLL_MS, useStatus, type DocLike } from './status';

const response = (state: 'ok' | 'down' = 'ok'): StatusResponse => ({
  server: { state: 'ok', version: '1', uptimeSeconds: 1 },
  intervalSeconds: 60,
  checks: [
    { provider: 'binance', providerName: 'Binance', feed: 'history', state, latencyMs: 5, checkedAt: 1, lastOkAt: 1, error: null, source: 'probe' },
  ],
});

function fakeDoc(hidden = false) {
  const listeners = new Set<() => void>();
  const doc: DocLike & { hidden: boolean } = {
    hidden,
    addEventListener: (_t, fn) => void listeners.add(fn),
    removeEventListener: (_t, fn) => void listeners.delete(fn),
  };
  return {
    doc,
    listeners,
    setHidden(h: boolean) {
      doc.hidden = h;
      for (const fn of [...listeners]) fn();
    },
  };
}

function harness(hidden = false) {
  const d = fakeDoc(hidden);
  const calls: Array<{ refresh: boolean }> = [];
  let ticks: Array<() => void> = [];
  let cleared = 0;
  let next: () => Promise<StatusResponse> = async () => response();
  const fetchStatus = (_s?: AbortSignal, refresh = false) => {
    calls.push({ refresh });
    return next();
  };
  const deps = {
    fetchStatus,
    doc: d.doc,
    setInterval: (fn: () => void, ms: number) => {
      expect(ms).toBe(POLL_MS);
      ticks.push(fn);
      return ticks.length;
    },
    clearInterval: () => {
      cleared++;
      ticks = [];
    },
  };
  return {
    d,
    calls,
    deps,
    get ticks() {
      return ticks;
    },
    get cleared() {
      return cleared;
    },
    set next(fn: () => Promise<StatusResponse>) {
      next = fn;
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  useStatus.getState().stopPolling();
  useStatus.setState({ status: null, loading: false, error: null });
});

describe('polling', () => {
  it('polls at once and then every 30 s while visible', async () => {
    const h = harness();
    useStatus.getState().startPolling(h.deps);
    expect(h.calls).toHaveLength(1);
    await settle();
    expect(useStatus.getState().status?.server.state).toBe('ok');
    h.ticks[0]();
    h.ticks[0]();
    expect(h.calls).toHaveLength(3);
    expect(h.calls.every((c) => !c.refresh)).toBe(true);
  });

  it('does not poll while hidden, pauses when hidden and polls at once when visible again', async () => {
    const h = harness(true);
    useStatus.getState().startPolling(h.deps);
    expect(h.calls).toHaveLength(0);
    expect(h.ticks).toHaveLength(0);
    h.d.setHidden(false);
    expect(h.calls).toHaveLength(1);
    expect(h.ticks).toHaveLength(1);
    h.d.setHidden(true);
    expect(h.cleared).toBe(1);
    expect(h.ticks).toHaveLength(0);
    h.d.setHidden(false);
    expect(h.calls).toHaveLength(2);
    expect(h.ticks).toHaveLength(1);
  });

  it('stopPolling removes the listener and the timer', () => {
    const h = harness();
    useStatus.getState().startPolling(h.deps);
    useStatus.getState().stopPolling();
    expect(h.d.listeners.size).toBe(0);
    expect(h.ticks).toHaveLength(0);
  });

  it('a failed request marks the server down and keeps the rows as unknown', async () => {
    const h = harness();
    useStatus.getState().startPolling(h.deps);
    await settle();
    h.next = async () => {
      throw new Error('HTTP 500');
    };
    h.ticks[0]();
    await settle();
    const s = useStatus.getState();
    expect(s.status?.server.state).toBe('down');
    expect(s.status?.checks.map((c) => [c.provider, c.state])).toEqual([['binance', 'unknown']]);
    expect(s.error).toBe('HTTP 500');
    h.next = async () => response();
    h.ticks[0]();
    await settle();
    expect(useStatus.getState().status?.server.state).toBe('ok');
    expect(useStatus.getState().error).toBeNull();
  });
});

describe('testNow', () => {
  it('sends refresh=1, shows loading meanwhile and stores the answer', async () => {
    const h = harness();
    let release: (r: StatusResponse) => void = () => undefined;
    h.next = () => new Promise((resolve) => (release = resolve));
    const p = useStatus.getState().testNow(h.deps);
    expect(useStatus.getState().loading).toBe(true);
    expect(h.calls).toEqual([{ refresh: true }]);
    await useStatus.getState().testNow(h.deps); // a second click while running sends nothing
    expect(h.calls).toHaveLength(1);
    release(response('down'));
    await p;
    expect(useStatus.getState().loading).toBe(false);
    expect(useStatus.getState().status?.checks[0].state).toBe('down');
  });

  it('clears loading when the request fails and marks the server down', async () => {
    const h = harness();
    h.next = async () => {
      throw new Error('network');
    };
    await useStatus.getState().testNow(h.deps);
    expect(useStatus.getState().loading).toBe(false);
    expect(useStatus.getState().status?.server.state).toBe('down');
  });
});
