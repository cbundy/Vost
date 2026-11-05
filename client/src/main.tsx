import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isComparePath, isStrategyMakerPath } from './lib/route';
import './styles.css';

// The compare page is its own chunk and never starts the chart app (market data, sockets, alert polling).
const ComparePage = lazy(() => import('./components/ComparePage'));
// The strategy maker page is its own chunk too and shares nothing with the chart app.
const StrategyMakerPage = lazy(() => import('./strategyMaker/StrategyMakerPage'));

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {isComparePath(location.pathname) ? (
      <Suspense fallback={null}>
        <ComparePage />
      </Suspense>
    ) : isStrategyMakerPath(location.pathname) ? (
      <Suspense fallback={null}>
        <StrategyMakerPage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
