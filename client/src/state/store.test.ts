import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function stubStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  });
}

type TestStore = (typeof import('./store'))['useStore'];
const used: TestStore[] = [];
const track = (s: TestStore) => {
  used.push(s);
  return s;
};

async function afterEachCleanup() {
  const stores = used.splice(0);
  for (const s of stores) {
    await vi.waitFor(() => {
      expect(Object.values(s.getState().pineRuns).some((r) => r.running)).toBe(false);
    }, { timeout: 20000 });
    // flush while this test's storage stub is still in place
    s.getState().flushPersist();
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
}

afterEach(afterEachCleanup);

describe('addSymbolToWatchlist', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  it('adds to the active list once; a second call is a no-op', async () => {
    const { useStore } = await import('./store');
    track(useStore);
    const st = useStore.getState();
    const count = () =>
      useStore.getState().watchlists.lists.find((l) => l.id === useStore.getState().watchlists.activeListId)!.sections
        .flatMap((s) => s.items)
        .filter((i) => i.symbol === 'ZZZUSDT').length;
    st.addSymbolToWatchlist({ symbol: 'ZZZUSDT', label: 'ZZZ / USDT' });
    expect(count()).toBe(1);
    useStore.getState().addSymbolToWatchlist({ symbol: 'ZZZUSDT', label: 'ZZZ / USDT' });
    expect(count()).toBe(1);
    expect(useStore.getState().toasts.map((t) => t.kind)).toEqual(['success', 'info']);
  });
});

describe('pine indicators', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  async function setup() {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { candlesFromCsvText } = await import('../lib/csv');
    const text = readFileSync(fileURLToPath(new URL('../../../examples/sample-daily.csv', import.meta.url)), 'utf8');
    const candles = candlesFromCsvText(text).candles;
    const { useStore } = await import('./store');
    track(useStore);
    useStore.setState({ candles });
    return { useStore, candles };
  }

  const settle = async (useStore: Awaited<ReturnType<typeof setup>>['useStore'], id: string) => {
    await vi.waitFor(() => {
      const run = useStore.getState().pineRuns[id];
      expect(run && !run.running).toBe(true);
    }, { timeout: 20000 });
    return useStore.getState().pineRuns[id];
  };
  const pineId = (useStore: Awaited<ReturnType<typeof setup>>['useStore']) =>
    useStore.getState().indicators.find((i) => i.kind === 'pine')!.id;

  it('adds a pine indicator, runs it, and recomputes when an input changes', async () => {
    const { useStore, candles } = await setup();
    useStore.getState().addIndicator('pine');
    const id = pineId(useStore);
    const first = await settle(useStore, id);
    expect(first.error).toBeUndefined();
    expect(first.result!.inputs.map((i) => i.name)).toEqual(['Fast', 'Slow']);
    expect(first.result!.plots[0].values).toHaveLength(candles.length);

    useStore.getState().updateIndicator(id, { inputs: { Fast: 3 } });
    await vi.waitFor(() => expect(useStore.getState().pineRuns[id].result).not.toBe(first.result), { timeout: 20000 });
    const second = await settle(useStore, id);
    const spec = useStore.getState().indicators.find((i) => i.id === id)!;
    expect(spec.inputs).toEqual({ Fast: 3 });
    // a 3-bar EMA has a value from bar 3 on; a 9-bar one does not
    expect(first.result!.plots[0].values[4]).toBeNull();
    expect(second.result!.plots[0].values[4]).not.toBeNull();
  });

  it('shows a compile error on the entry and leaves other indicators alone', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { useStore } = await setup();
    const bad = readFileSync(fileURLToPath(new URL('../lib/pine/fixtures/syntax-error.pine', import.meta.url)), 'utf8');
    useStore.getState().addIndicator('pine');
    const id = pineId(useStore);
    await settle(useStore, id);
    useStore.getState().updateIndicator(id, { source: bad });
    await vi.waitFor(() => expect(useStore.getState().pineRuns[id].error).toBeDefined(), { timeout: 20000 });
    const run = await settle(useStore, id);
    expect(run.error!.message).toBeTruthy();
    expect(run.error!.line).toBeTypeOf('number');
    const { computeIndicator } = await import('../lib/indicatorCompute');
    const sma = useStore.getState().indicators.find((i) => i.kind === 'sma')!;
    expect(computeIndicator(sma, useStore.getState().candles)[0].data.length).toBeGreaterThan(0);
  });

  it('persists source and inputs; old prefs without pine entries still load', async () => {
    vi.useFakeTimers();
    try {
      const { useStore } = await setup();
      useStore.getState().addIndicator('pine');
      const id = pineId(useStore);
      useStore.getState().updateIndicator(id, { source: '//@version=6\nindicator("X")\nplot(close)\n', inputs: { Fast: 4 } });
      vi.advanceTimersByTime(1000);
      const raw = localStorage.getItem('vost.prefs.v1');
      expect(raw).not.toBeNull();
      // Reload: a fresh store reads the same prefs back.
      vi.resetModules();
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
      const fresh = track((await import('./store')).useStore);
      fresh.getState().init();
      const pine = fresh.getState().indicators.find((i) => i.id === id)!;
      expect(pine.kind).toBe('pine');
      expect(pine.source).toContain('plot(close)');
      expect(pine.inputs).toEqual({ Fast: 4 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('loads old saved prefs that have no pine entries', async () => {
    localStorage.setItem(
      'vost.prefs.v1',
      JSON.stringify({
        providerId: 'binance',
        symbol: 'BTCUSDT',
        timeframe: '1h',
        bars: 100,
        indicators: [{ id: 'old1', kind: 'sma', params: { length: 5 }, color: '#fff', visible: true }],
      }),
    );
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const { useStore } = await import('./store');
    track(useStore);
    useStore.getState().init();
    expect(useStore.getState().indicators.map((i) => i.id)).toEqual(['old1']);
    expect(useStore.getState().pineRuns).toEqual({});
  });
});

describe('stale persist isolation', () => {
  it('a pending save from a previous store cannot write into the next test', async () => {
    vi.resetModules();
    stubStorage();
    const { useStore } = await import('./store');
    useStore.getState().addIndicator('sma');
    used.push(useStore);
    await afterEachCleanup();
    stubStorage();
    await new Promise((r) => setTimeout(r, 700));
    expect(localStorage.getItem('vost.prefs.v1')).toBeNull();
  });
});
