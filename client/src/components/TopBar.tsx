import { useEffect, useState, type Ref } from 'react';
import { APP_VERSION, PROVIDER_GITHUB_URL } from '../lib/constants';
import { fmtDataRange } from '../lib/format';
import { topbarTier } from '../lib/paneSizes';
import { useViewportSize } from '../lib/useViewportSize';
import { getProvider, providers } from '../lib/providers';
import { TIMEFRAMES } from '../types';
import { unreadCount } from '../lib/messages';
import { useAlerts } from '../state/alerts';
import { selectDataCandles, useStore } from '../state/store';
import { ChartRangeControl } from './ChartRangeControl';
import { BellIcon, InboxIcon, RefreshIcon, ReplayIcon, SidebarIcon, StarIcon, UploadIcon } from './Icons';
import { ConnectionStatus } from './ConnectionStatus';
import { SymbolSearch } from './SymbolSearch';
import { TopBarMore } from './TopBarMore';

const BAR_OPTIONS = [500, 1000, 2000, 5000, 10000, 20000];

export function TopBar({
  onImportCsv,
  onToggleSidebar,
  onOpenInbox,
  onOpenAlerts,
  sidebarExpanded,
  toggleRef,
}: {
  onImportCsv: () => void;
  onToggleSidebar: () => void;
  onOpenInbox: () => void;
  onOpenAlerts: () => void;
  sidebarExpanded: boolean;
  toggleRef?: Ref<HTMLButtonElement>;
}) {
  const tier = topbarTier(useViewportSize().width);
  const providerInMore = tier === 'narrow' || tier === 'tiny';
  const importInMore = tier !== 'full';

  const providerId = useStore((s) => s.providerId);
  const timeframe = useStore((s) => s.timeframe);
  const bars = useStore((s) => s.bars);
  const loadState = useStore((s) => s.loadState);
  const activeAlerts = useAlerts((s) => s.alerts.filter((a) => a.status === 'active').length);
  const unread = useStore((s) => unreadCount(s.messages));
  const live = useStore((s) => s.live);
  const candles = useStore(selectDataCandles);
  const replayOn = useStore((s) => s.replay != null);
  const hasBars = useStore((s) => s.candles.length >= 3);
  const chartRange = useStore((s) => s.chartRange);
  const timeZone = useStore((s) => s.timeZone);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const liveStatus = useStore((s) => s.liveStatus);
  const liveDetail = useStore((s) => s.liveDetail);
  const setProvider = useStore((s) => s.setProvider);
  const setTimeframe = useStore((s) => s.setTimeframe);
  const setBars = useStore((s) => s.setBars);
  const loadData = useStore((s) => s.loadData);
  const setLive = useStore((s) => s.setLive);

  useEffect(() => {
    if (!live) return;
    setNow(Date.now() / 1000);
    const id = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(id);
  }, [live]);

  const rangeText = fmtDataRange(candles[0]?.time, candles[candles.length - 1]?.time, candles.length, { live: live && !chartRange, now, timeZone });

  const provider = getProvider(providerId);
  const timeframes = TIMEFRAMES.filter((tf) => provider.timeframes.includes(tf));

  const liveClass = liveStatus === 'live' ? '' : liveStatus === 'connecting' || liveStatus === 'reconnecting' ? 'connecting' : 'error';

  const providerSelect = (
    <div className="field">
      <select value={providerId} onChange={(e) => setProvider(e.target.value)} title={provider.description} aria-label="Provider">
        {providers.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
  const barsSelect = (
    <div className="field">
      <select value={bars} onChange={(e) => setBars(Number(e.target.value))} title="Number of bars to request" aria-label="Number of bars">
        {BAR_OPTIONS.map((b) => (
          <option key={b} value={b}>
            {b >= 1000 ? `${b / 1000}k bars` : `${b} bars`}
          </option>
        ))}
      </select>
    </div>
  );
  const liveButton = provider.supportsLive && (
    <button
      className={live ? 'badge green' : 'badge'}
      style={{ cursor: 'pointer' }}
      onClick={() => (liveStatus === 'error' ? onOpenInbox() : setLive(!live))}
      title={liveStatus === 'error' ? `${liveDetail} - click to open the inbox` : liveDetail || 'Stream live candles from Binance'}
    >
      <span className={`live-dot ${liveClass}`} />
      {liveStatus === 'live' ? 'LIVE' : liveStatus === 'connecting' ? '…' : liveStatus === 'reconnecting' ? 'RETRY' : liveStatus === 'error' ? 'ERR' : 'Live'}
    </button>
  );
  const replayButton = (after?: () => void) => (
    <button
      className={replayOn ? 'badge blue' : 'badge'}
      style={{ cursor: 'pointer' }}
      disabled={!hasBars && !replayOn}
      aria-pressed={replayOn}
      title={replayOn ? 'Leave bar replay' : 'Replay the chart bar by bar from a bar you pick'}
      onClick={() => {
        after?.();
        const st = useStore.getState();
        if (st.replay) st.exitReplay();
        else st.startReplayPick();
      }}
    >
      <ReplayIcon />
      Replay
    </button>
  );
  const importButton = (after?: () => void) => (
    <button
      onClick={() => {
        after?.();
        onImportCsv();
      }}
      title="Import OHLCV CSV — works fully offline"
    >
      <UploadIcon />
      Import CSV
    </button>
  );
  const githubLink = (
    <a className="badge" href={PROVIDER_GITHUB_URL} target="_blank" rel="noreferrer" title="Star Vost on GitHub">
      <StarIcon />
      GitHub
    </a>
  );

  return (
    <header className="topbar">
      <button
        ref={toggleRef}
        className="ghost icon"
        title="Toggle sidebar"
        aria-label="Toggle sidebar"
        aria-expanded={sidebarExpanded}
        aria-controls="sidebar"
        onClick={onToggleSidebar}
      >
        <SidebarIcon />
      </button>

      <div className="brand" title={`Vost v${APP_VERSION} — self-hosted charts & backtesting`}>
        <span className="brand-logo">
          <svg width="16" height="16" viewBox="0 0 32 32">
            <rect x="5" y="9" width="4" height="14" rx="1" fill="#22c55e" />
            <rect x="6.4" y="5" width="1.2" height="22" fill="#22c55e" />
            <rect x="14" y="12" width="4" height="10" rx="1" fill="#ef4444" />
            <rect x="15.4" y="8" width="1.2" height="18" fill="#ef4444" />
            <rect x="23" y="7" width="4" height="12" rx="1" fill="#22c55e" />
            <rect x="24.4" y="4" width="1.2" height="19" fill="#22c55e" />
          </svg>
        </span>
        <span className="brand-name">Vost</span>
      </div>

      <div className="topbar-sep" />

      {!providerInMore && providerSelect}

      <SymbolSearch />

      <div className="field">
        <select
          value={timeframe}
          onChange={(e) => setTimeframe(e.target.value as (typeof timeframes)[number])}
          title="Timeframe"
        >
          {timeframes.map((tf) => (
            <option key={tf} value={tf}>
              {tf}
            </option>
          ))}
        </select>
      </div>

      {!importInMore && barsSelect}

      {rangeText && (
        <span className="topbar-range" title={rangeText}>
          {rangeText}
        </span>
      )}

      <button className="primary" onClick={() => void loadData()} disabled={loadState === 'loading'} title="Reload data" aria-label="Load">
        {loadState === 'loading' ? (
          <span className="spinner" />
        ) : (
          <>
            <RefreshIcon />
            <span className="btn-label">Load</span>
          </>
        )}
      </button>

      {!providerInMore && liveButton}

      {!providerInMore && replayButton()}

      <ConnectionStatus />

      <div className="topbar-right">
        <button className="ghost icon inbox-btn" onClick={onOpenInbox} title="Inbox (messages and errors)" aria-label="Inbox">
          <InboxIcon />
          {unread > 0 && <span className="inbox-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <button className="ghost icon inbox-btn" onClick={onOpenAlerts} title="Alerts" aria-label="Alerts">
          <BellIcon />
          {activeAlerts > 0 && <span className="inbox-badge alerts-badge" data-testid="alerts-badge">{activeAlerts > 99 ? '99+' : activeAlerts}</span>}
        </button>
        {!importInMore && importButton()}
        {!importInMore && githubLink}
        {importInMore && (
          <TopBarMore>
            {(close) => (
              <>
                {tier === 'tiny' && (
                  <div className="more-row more-version">
                    <span className="brand-name-plain">Vost</span> <span className="muted-2">v{APP_VERSION}</span>
                  </div>
                )}
                {providerInMore && (
                  <div className="more-row">
                    <span className="more-label">Provider</span>
                    {providerSelect}
                  </div>
                )}
                <div className="more-row">
                  <span className="more-label">Bars</span>
                  {barsSelect}
                </div>
                {providerInMore && (
                  <div className="more-row">
                    <span className="more-label">Range</span>
                    <ChartRangeControl />
                  </div>
                )}
                {providerInMore && liveButton && (
                  <div className="more-row">
                    <span className="more-label">Live</span>
                    {liveButton}
                  </div>
                )}
                {providerInMore && (
                  <div className="more-row">
                    <span className="more-label">Replay</span>
                    {replayButton(close)}
                  </div>
                )}
                <div className="more-row">{importButton(close)}</div>
                <div className="more-row">{githubLink}</div>
              </>
            )}
          </TopBarMore>
        )}
      </div>
    </header>
  );
}
