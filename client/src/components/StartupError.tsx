/** Shown instead of the app when the Vost server cannot be reached at start-up: nothing is built until it answers. */
export default function StartupError({ onRetry, busy = false }: { onRetry: () => void; busy?: boolean }) {
  return (
    <div className="startup-error" role="alert">
      <h1>The Vost server cannot be reached</h1>
      <p>Vost keeps your settings, layouts, drawings and watchlists on its server, so it cannot start without it. Check that the server is running, then try again.</p>
      <button type="button" className="primary" onClick={onRetry} disabled={busy}>
        {busy ? 'Trying...' : 'Retry'}
      </button>
    </div>
  );
}
