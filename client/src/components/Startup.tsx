import { type ReactNode } from 'react';
import StartupError from './StartupError';

export type StartupStatus = 'loading' | 'ready' | 'failed';

/** Runs the start-up load and holds its status; `retry()` runs the load again. */
export function createStartup(load: () => Promise<void>) {
  let status: StartupStatus = 'loading';
  const listeners = new Set<() => void>();
  const set = (next: StartupStatus) => {
    status = next;
    for (const l of [...listeners]) l();
  };
  const run = () => {
    set('loading');
    load().then(
      () => set('ready'),
      () => set('failed'),
    );
  };
  run();
  return {
    status: () => status,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    retry: () => {
      if (status === 'failed') run();
    },
  };
}

/** The page once the settings are loaded, the error page when the server cannot be reached, nothing while loading. */
export function StartupView({ status, onRetry, page }: { status: StartupStatus; onRetry: () => void; page: () => ReactNode }) {
  if (status === 'ready') return <>{page()}</>;
  if (status === 'failed') return <StartupError onRetry={onRetry} />;
  return null;
}
