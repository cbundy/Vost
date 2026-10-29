/**
 * Binds a subtree to one chart store. Panels read the chart they show with `useChart`; app-wide state stays on
 * `useStore`. `useChartStore` gives the store itself for imperative `getState()` calls.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useStore as useZustandStore } from 'zustand';
import type { ChartState, ChartStore } from './chart';

const ChartContext = createContext<ChartStore | null>(null);

export function ChartStoreProvider({ store, children }: { store: ChartStore; children: ReactNode }) {
  return <ChartContext.Provider value={store}>{children}</ChartContext.Provider>;
}

export function useChartStore(): ChartStore {
  const store = useContext(ChartContext);
  if (!store) throw new Error('useChart must be used inside a ChartStoreProvider');
  return store;
}

export function useChart<T>(selector: (s: ChartState) => T): T {
  return useZustandStore(useChartStore(), selector);
}

/** Number of bars on the chart the panel is bound to. */
export function useActiveBarCount(): number {
  return useChart((s) => s.candles.length);
}
