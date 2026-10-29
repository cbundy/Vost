import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { isComparePath } from './lib/route';
import './styles.css';

// The compare page is its own chunk and never starts the chart app (market data, sockets, alert polling).
const ComparePage = lazy(() => import('./components/ComparePage'));

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {isComparePath(location.pathname) ? (
      <Suspense fallback={null}>
        <ComparePage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
