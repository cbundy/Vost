import { beforeEach, describe, expect, it, vi } from 'vitest';

function stubStorage() {
  const store: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => void (store[k] = v),
    removeItem: (k: string) => void delete store[k],
  });
}

describe('addSymbolToWatchlist', () => {
  beforeEach(() => {
    vi.resetModules();
    stubStorage();
  });

  it('adds to the active list once; a second call is a no-op', async () => {
    const { useStore } = await import('./store');
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
