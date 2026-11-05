import { StrictMode, Suspense, lazy, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { StartupView, createStartup } from './components/Startup';
import { hydrate } from './lib/storage';
import { isComparePath, isStrategyMakerPath } from './lib/route';

// The compare page is its own chunk and never starts the chart app (market data, sockets, alert polling).
const ComparePage = lazy(() => import('./components/ComparePage'));
// The strategy maker page is its own chunk too and shares nothing with the chart app.
const StrategyMakerPage = lazy(() => import('./strategyMaker/StrategyMakerPage'));

/** The page for a path. */
export function pageFor(pathname: string): ReactNode {
  if (isComparePath(pathname))
    return (
      <Suspense fallback={null}>
        <ComparePage />
      </Suspense>
    );
  if (isStrategyMakerPath(pathname))
    return (
      <Suspense fallback={null}>
        <StrategyMakerPage />
      </Suspense>
    );
  return <App />;
}

function Startup({ startup, page }: { startup: ReturnType<typeof createStartup>; page: () => ReactNode }) {
  const status = useSyncExternalStore(startup.subscribe, startup.status);
  return <StartupView status={status} onRetry={startup.retry} page={page} />;
}

export function start(root: HTMLElement): void {
  createRoot(root).render(
    <StrictMode>
      <Startup startup={createStartup(hydrate)} page={() => pageFor(location.pathname)} />
    </StrictMode>,
  );
}
