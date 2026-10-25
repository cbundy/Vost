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

describe('timeZone pref', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  async function setup() {
    const { useStore } = await import('./store');
    track(useStore);
    return { useStore };
  }

  it('persists setTimeZone and a fresh store reads it back', async () => {
    vi.useFakeTimers();
    try {
      const { useStore } = await setup();
      useStore.getState().setTimeZone('Asia/Tehran');
      vi.advanceTimersByTime(1000);
      expect(JSON.parse(localStorage.getItem('vost.prefs.v1')!).timeZone).toBe('Asia/Tehran');
      vi.resetModules();
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
      const fresh = track((await import('./store')).useStore);
      fresh.getState().init();
      expect(fresh.getState().timeZone).toBe('Asia/Tehran');
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores an invalid zone and keeps the current one', async () => {
    const { useStore } = await setup();
    useStore.getState().setTimeZone('Asia/Tehran');
    useStore.getState().setTimeZone('Nope/Zone');
    expect(useStore.getState().timeZone).toBe('Asia/Tehran');
  });

  it('old prefs without timeZone and invalid stored zones fall back to the browser zone', async () => {
    const browser = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    for (const stored of [{}, { timeZone: 'Nope/Zone' }]) {
      localStorage.setItem('vost.prefs.v1', JSON.stringify({ providerId: 'binance', symbol: 'BTCUSDT', timeframe: '1h', bars: 100, ...stored }));
      vi.resetModules();
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
      const fresh = track((await import('./store')).useStore);
      fresh.getState().init();
      expect(fresh.getState().timeZone).toBe(browser);
    }
  });
});

describe('openWatchItem', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  it('sets provider and symbol together and loads once', async () => {
    const { useStore } = await import('./store');
    track(useStore);
    const seen: Array<{ providerId: string; symbol: string }> = [];
    const loadData = vi.fn().mockImplementation(async () => {
      const { providerId, symbol } = useStore.getState();
      seen.push({ providerId, symbol });
    });
    useStore.setState({ loadData });
    useStore.getState().openWatchItem('kraken', 'XBTUSD');
    expect(seen).toEqual([{ providerId: 'kraken', symbol: 'XBTUSD' }]);
    expect(useStore.getState().providerId).toBe('kraken');
    expect(useStore.getState().symbol).toBe('XBTUSD');
    expect(loadData).toHaveBeenCalledTimes(1);
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

describe('btRange', () => {
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

  const freshFromPrefs = async (btRange: unknown) => {
    localStorage.setItem('vost.prefs.v1', JSON.stringify({ providerId: 'binance', symbol: 'BTCUSDT', timeframe: '1h', bars: 100, btRange }));
    vi.resetModules();
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const fresh = track((await import('./store')).useStore);
    fresh.getState().init();
    return fresh;
  };

  it('runBacktest only sees in-range bars', async () => {
    const { useStore, candles } = await setup();
    const from = candles[20].time;
    const to = candles[80].time;
    useStore.getState().setBtRange({ from, to });
    await useStore.getState().runBacktest();
    const r = useStore.getState().btResult!;
    expect(r).not.toBeNull();
    expect(r.equity[0].time).toBe(from);
    expect(r.equity[r.equity.length - 1].time).toBe(to);
    for (const t of r.trades) {
      expect(t.entryTime).toBeGreaterThanOrEqual(from);
      expect(t.exitTime).toBeLessThanOrEqual(to);
    }
  });

  it('runOptimizer sends only in-range bars to the worker', async () => {
    const { useStore, candles } = await setup();
    const sent: { candles: { time: number }[] }[] = [];
    class FakeWorker {
      onmessage: ((ev: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(req: { id: string; candles: { time: number }[] }) {
        sent.push(req);
        queueMicrotask(() =>
          this.onmessage?.({ data: { id: req.id, type: 'optimizeResult', rows: [], metric: 'sharpe', combos: 0, errored: 0 } }),
        );
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const from = candles[10].time;
    const to = candles[40].time;
    useStore.getState().setBtRange({ from, to });
    await useStore.getState().runOptimizer();
    expect(sent).toHaveLength(1);
    expect(sent[0].candles).toHaveLength(31);
    expect(sent[0].candles[0].time).toBe(from);
    expect(sent[0].candles[30].time).toBe(to);
  });

  it('From later than To starts nothing and pushes an error toast', async () => {
    const { useStore, candles } = await setup();
    useStore.getState().setBtRange({ from: candles[50].time, to: candles[10].time });
    await useStore.getState().runBacktest();
    await useStore.getState().runOptimizer();
    const s = useStore.getState();
    expect(s.btRunning).toBe(false);
    expect(s.optRunning).toBe(false);
    expect(s.btResult).toBeNull();
    expect(s.toasts.some((t) => t.kind === 'error' && t.text.includes('From is later than To'))).toBe(true);
  });

  it('a range with fewer than 3 bars starts nothing', async () => {
    const { useStore, candles } = await setup();
    useStore.getState().setBtRange({ from: candles[5].time, to: candles[6].time });
    await useStore.getState().runBacktest();
    expect(useStore.getState().btResult).toBeNull();
    expect(useStore.getState().toasts.some((t) => t.text.includes('Fewer than 3 bars'))).toBe(true);
  });

  it('persists setBtRange and a fresh store reads it back', async () => {
    vi.useFakeTimers();
    try {
      const { useStore } = await setup();
      useStore.getState().setBtRange({ from: 100, to: null });
      vi.advanceTimersByTime(1000);
      expect(JSON.parse(localStorage.getItem('vost.prefs.v1')!).btRange).toEqual({ from: 100, to: null });
      const fresh = await freshFromPrefs(JSON.parse(localStorage.getItem('vost.prefs.v1')!).btRange);
      expect(fresh.getState().btRange).toEqual({ from: 100, to: null });
    } finally {
      vi.useRealTimers();
    }
  });

  it('old prefs and malformed values fall back to an open range', async () => {
    for (const stored of [undefined, 'x', { from: 'a' }, { from: 1 }, null]) {
      const fresh = await freshFromPrefs(stored);
      expect(fresh.getState().btRange).toEqual({ from: null, to: null });
    }
  });

  it('keeps the range across a new data load', async () => {
    const { useStore, candles } = await setup();
    useStore.getState().setBtRange({ from: 5, to: 9 });
    const id = useStore.getState().addDataset({
      name: 'd1',
      candles,
      source: 'csv',
      description: 'd1',
      barSeconds: 86400,
      barLabel: '1d',
    });
    useStore.getState().activateDataset(id);
    expect(useStore.getState().dataLabel).toBeTruthy();
    expect(useStore.getState().btRange).toEqual({ from: 5, to: 9 });
  });
});

describe('chartRange', () => {
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

  const errorCount = (s: { messages: { severity: string }[] }) => s.messages.filter((m) => m.severity === 'error').length;

  it('crops inclusively, keeps the full bars and leaves btRange alone', async () => {
    const { useStore, candles } = await setup();
    const key = useStore.getState().dataKey;
    const from = candles[20].time;
    const to = candles[80].time;
    useStore.getState().setChartRange({ from, to });
    const s = useStore.getState();
    expect(s.candles).toHaveLength(61);
    expect(s.candles[0].time).toBe(from);
    expect(s.candles[60].time).toBe(to);
    expect(s.fullCandles).toEqual(candles);
    expect(s.chartRange).toEqual({ from, to });
    expect(s.dataKey).not.toBe(key);
    expect(s.btRange).toEqual({ from: null, to: null });
  });

  it('setBtRange leaves chartRange untouched', async () => {
    const { useStore, candles } = await setup();
    useStore.getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    useStore.getState().setBtRange({ from: candles[30].time, to: null });
    expect(useStore.getState().chartRange).toEqual({ from: candles[20].time, to: candles[80].time });
  });

  it('refuses a chart range while live is on', async () => {
    const { useStore, candles } = await setup();
    useStore.setState({ live: true });
    useStore.getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    const s = useStore.getState();
    expect(s.chartRange).toBeNull();
    expect(s.candles).toHaveLength(candles.length);
    expect(s.toasts[s.toasts.length - 1].text).toContain('Turn live off');
    useStore.setState({ live: false });
  });

  it('a second apply slices from the full set', async () => {
    const { useStore, candles } = await setup();
    useStore.getState().setChartRange({ from: candles[20].time, to: candles[30].time });
    useStore.getState().setChartRange({ from: candles[10].time, to: candles[90].time });
    expect(useStore.getState().candles).toHaveLength(81);
    expect(useStore.getState().fullCandles).toEqual(candles);
  });

  it('refusals add one error and change nothing', async () => {
    const { useStore, candles } = await setup();
    useStore.getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    const before = useStore.getState();
    const cases: [{ from: number | null; to: number | null }, string][] = [
      [{ from: candles[0].time - 1, to: null }, 'Range is outside the loaded data - load more bars first'],
      [{ from: null, to: candles[candles.length - 1].time + 1 }, 'Range is outside the loaded data - load more bars first'],
      [{ from: candles[50].time, to: candles[10].time }, 'From is later than To'],
      [{ from: candles[5].time, to: candles[5].time }, 'Fewer than 2 bars in the chart range'],
    ];
    let n = errorCount(before);
    for (const [range, text] of cases) {
      useStore.getState().setChartRange(range);
      const s = useStore.getState();
      expect(errorCount(s)).toBe(++n);
      expect(s.toasts.some((t) => t.kind === 'error' && t.text === text)).toBe(true);
      expect(s.candles).toBe(before.candles);
      expect(s.dataKey).toBe(before.dataKey);
      expect(s.chartRange).toBe(before.chartRange);
    }
  });

  it('refusals on uncropped data change nothing', async () => {
    const { useStore, candles } = await setup();
    const key = useStore.getState().dataKey;
    useStore.getState().setChartRange({ from: candles[0].time - 5, to: null });
    const s = useStore.getState();
    expect(s.chartRange).toBeNull();
    expect(s.fullCandles).toBeNull();
    expect(s.candles).toBe(candles);
    expect(s.dataKey).toBe(key);
  });

  it('clearChartRange restores the bars without fetching', async () => {
    const { useStore, candles } = await setup();
    const fetchSpy = vi.fn(() => {
      throw new Error('no fetch expected');
    });
    vi.stubGlobal('fetch', fetchSpy);
    useStore.getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    const key = useStore.getState().dataKey;
    useStore.getState().clearChartRange();
    const s = useStore.getState();
    expect(s.candles).toBe(candles);
    expect(s.fullCandles).toBeNull();
    expect(s.chartRange).toBeNull();
    expect(s.dataKey).not.toBe(key);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an open range acts as Clear', async () => {
    const { useStore, candles } = await setup();
    useStore.getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    useStore.getState().setChartRange({ from: null, to: null });
    expect(useStore.getState().candles).toBe(candles);
    expect(useStore.getState().chartRange).toBeNull();
  });

  it('activateDataset, addDataset and clearData reset the range', async () => {
    const { useStore, candles } = await setup();
    const input = { name: 'd1', candles, source: 'csv', description: 'd1', barSeconds: 86400, barLabel: '1d' };
    const range = { from: candles[20].time, to: candles[80].time };
    useStore.getState().setChartRange(range);
    const id = useStore.getState().addDataset(input);
    expect(useStore.getState().chartRange).toBeNull();
    expect(useStore.getState().fullCandles).toBeNull();
    useStore.getState().setChartRange(range);
    useStore.getState().activateDataset(id);
    expect(useStore.getState().chartRange).toBeNull();
    expect(useStore.getState().candles).toHaveLength(candles.length);
    useStore.getState().setChartRange(range);
    useStore.getState().clearData();
    expect(useStore.getState().chartRange).toBeNull();
    expect(useStore.getState().fullCandles).toBeNull();
  });

  it('loadData resets the range', async () => {
    const { useStore, candles } = await setup();
    useStore.setState({ providerId: 'demo', bars: 200 });
    useStore.getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    await useStore.getState().loadData();
    expect(useStore.getState().loadState).toBe('ready');
    expect(useStore.getState().chartRange).toBeNull();
    expect(useStore.getState().fullCandles).toBeNull();
  });

  it('setLive(true) restores the full candles first', async () => {
    const { useStore, candles } = await setup();
    const { getProvider } = await import('../lib/providers');
    const provider = getProvider('binance');
    const orig = provider.startLive;
    provider.startLive = () => ({ stop() {} });
    try {
      useStore.getState().setChartRange({ from: candles[20].time, to: candles[80].time });
      useStore.getState().setLive(true);
      expect(useStore.getState().candles).toBe(candles);
      expect(useStore.getState().chartRange).toBeNull();
      useStore.getState().setLive(false);
    } finally {
      provider.startLive = orig;
    }
  });

  it('runBacktest runs only on the cropped bars', async () => {
    const { useStore, candles } = await setup();
    const from = candles[20].time;
    const to = candles[80].time;
    useStore.getState().setChartRange({ from, to });
    await useStore.getState().runBacktest();
    const r = useStore.getState().btResult!;
    expect(r.equity[0].time).toBe(from);
    expect(r.equity[r.equity.length - 1].time).toBe(to);
  });

  it('saveCurrentDataset stores the full candles', async () => {
    const { useStore, candles } = await setup();
    useStore.getState().setChartRange({ from: candles[20].time, to: candles[80].time });
    useStore.getState().saveCurrentDataset('full');
    const saved = useStore.getState().datasets.find((d) => d.name === 'full')!;
    expect(saved.candles).toHaveLength(candles.length);
  });

  it('is not persisted and a fresh store has no range', async () => {
    vi.useFakeTimers();
    try {
      const { useStore, candles } = await setup();
      useStore.getState().setChartRange({ from: candles[20].time, to: candles[80].time });
      useStore.getState().setBars(300);
      vi.advanceTimersByTime(1000);
      expect(localStorage.getItem('vost.prefs.v1')).not.toContain('chartRange');
      vi.resetModules();
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
      const fresh = track((await import('./store')).useStore);
      fresh.getState().init();
      expect(fresh.getState().chartRange).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
