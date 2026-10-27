import { useEffect, useRef, useState } from 'react';
import { groupByProvider, problemCount, relativeTime, summaryText, uptimeText, worstState, type StatusCheck } from '../lib/status';
import { useStatus } from '../state/status';

const FEED_NAMES: Record<StatusCheck['feed'], string> = { history: 'Price history', symbols: 'Symbol lookup', live: 'Live stream' };

function Row({ check, now }: { check: StatusCheck; now: number }) {
  return (
    <div className="conn-row" data-state={check.state}>
      <span className="conn-dot" data-state={check.state} aria-hidden="true" />
      <span className="conn-feed">{FEED_NAMES[check.feed]}</span>
      <span className="conn-state">{check.state}</span>
      <span className="conn-meta">
        {check.latencyMs !== null && `${check.latencyMs} ms`}
        {check.latencyMs !== null && check.lastOkAt !== null && ' · '}
        {check.lastOkAt !== null ? `last ok ${relativeTime(check.lastOkAt, now)}` : check.checkedAt === null ? 'not checked yet' : 'never ok'}
      </span>
      {check.error && <span className="conn-error">{check.error}</span>}
    </div>
  );
}

export function ConnectionStatus() {
  const status = useStatus((s) => s.status);
  const loading = useStatus((s) => s.loading);
  const error = useStatus((s) => s.error);
  const startPolling = useStatus((s) => s.startPolling);
  const stopPolling = useStatus((s) => s.stopPolling);
  const testNow = useStatus((s) => s.testNow);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState({ top: 0, right: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    startPolling();
    return stopPolling;
  }, [startPolling, stopPolling]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) btnRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (ev: MouseEvent) => {
      if (!wrapRef.current?.contains(ev.target as Node)) close(true);
    };
    const onResize = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const toggle = () => {
    if (open) return close(false);
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) setPlace({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
    setOpen(true);
  };

  const state = worstState(status);
  const count = problemCount(status);
  const text = summaryText(status);
  const now = Date.now();

  return (
    <div
      className="conn-status"
      ref={wrapRef}
      onKeyDown={(e) => {
        if (open && e.key === 'Escape') {
          e.preventDefault();
          close(true);
        }
      }}
    >
      <button
        ref={btnRef}
        className="ghost conn-btn"
        title={text}
        aria-label={text}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="conn-dot" data-state={state} aria-hidden="true" />
        {count > 0 && <span className="conn-count">{count}</span>}
      </button>
      {open && (
        <div
          className="conn-pop"
          role="dialog"
          aria-label="Connection status"
          style={{ ['--conn-top' as string]: `${place.top}px`, ['--conn-right' as string]: `${place.right}px` }}
        >
          <div className="conn-head">
            <span className="conn-title">{text}</span>
            <button className="conn-test" onClick={() => void testNow()} disabled={loading} title="Check every exchange now">
              {loading ? <span className="spinner" /> : 'Test now'}
            </button>
          </div>
          <div className="conn-list">
            <div className="conn-provider">
              <div className="conn-provider-name">Vost server</div>
              <div className="conn-row" data-state={status?.server.state ?? 'unknown'}>
                <span className="conn-dot" data-state={status?.server.state ?? 'unknown'} aria-hidden="true" />
                <span className="conn-feed">{status?.server.state === 'down' ? 'Unreachable' : status ? 'Running' : 'Checking'}</span>
                <span className="conn-meta">
                  {status?.server.version ? `v${status.server.version}` : ''}
                  {status?.server.state === 'ok' && status.server.uptimeSeconds !== null ? ` · up ${uptimeText(status.server.uptimeSeconds)}` : ''}
                </span>
                {status?.server.state === 'down' && error && <span className="conn-error">{error}</span>}
              </div>
            </div>
            {groupByProvider(status?.checks ?? []).map((g) => (
              <div className="conn-provider" key={g.provider}>
                <div className="conn-provider-name">{g.providerName}</div>
                {g.checks.map((c) => (
                  <Row key={c.feed} check={c} now={now} />
                ))}
              </div>
            ))}
          </div>
          {status && status.intervalSeconds === 0 && <div className="conn-note">Background checks are off on this server; use Test now.</div>}
        </div>
      )}
    </div>
  );
}
