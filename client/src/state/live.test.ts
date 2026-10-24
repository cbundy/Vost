import { afterEach, describe, expect, it, vi } from 'vitest';
import { useStore } from './store';
import * as providers from '../lib/providers';

afterEach(() => vi.restoreAllMocks());

describe('setLive', () => {
  it('starts the stream through the provider and stops it', () => {
    const stop = vi.fn();
    const startLive = vi.fn((o: { onStatus: (s: 'live') => void }) => {
      o.onStatus('live');
      return { stop };
    });
    vi.spyOn(providers, 'getProvider').mockReturnValue({ ...providers.demoProvider, name: 'Fake', supportsLive: true, startLive } as never);
    useStore.getState().setLive(true);
    expect(startLive).toHaveBeenCalledOnce();
    expect(useStore.getState().liveStatus).toBe('live');
    useStore.getState().setLive(false);
    expect(stop).toHaveBeenCalledOnce();
    expect(useStore.getState().live).toBe(false);
  });

  it('refuses providers without startLive with a neutral toast', () => {
    vi.spyOn(providers, 'getProvider').mockReturnValue({ ...providers.demoProvider, name: 'Fake' } as never);
    useStore.getState().setLive(true);
    expect(useStore.getState().live).toBe(false);
    const toasts = useStore.getState().toasts;
    expect(toasts[toasts.length - 1].text).toBe('Live streaming is not available for Fake data.');
  });
});
