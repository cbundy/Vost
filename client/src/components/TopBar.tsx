import { useEffect, useState, type Ref } from 'react';
import { APP_VERSION, PROVIDER_GITHUB_URL } from '../lib/constants';
import { fmtDataRange } from '../lib/format';
import { topbarTier } from '../lib/paneSizes';
import { useViewportSize } from '../lib/useViewportSize';
import { getProvider, providers } from '../lib/providers';
import { pickerTimeframes } from '../lib/customTimeframes';
import { IntervalDialog } from './IntervalDialog';
import { unreadCount } from '../lib/messages';
import { useAlerts } from '../state/alerts';
import { useStore } from '../state/store';
import { selectDataCandles } from '../state/chart';
import { ChartRangeControl } from './ChartRangeControl';
import { BellIcon, GearIcon, InboxIcon, RefreshIcon, ReplayIcon, StarIcon, UploadIcon } from './Icons';
import { ConnectionStatus } from './ConnectionStatus';
import { LayoutDialogs } from './LayoutDialogs';
import { LayoutMenu } from './LayoutMenu';
import { LayoutPicker } from './LayoutPicker';
import { SettingsDialog } from './SettingsDialog';
import { SymbolSearch } from './SymbolSearch';
import { TopBarMore } from './TopBarMore';
import type { Interval } from '../types';
import { useChart, useChartStore } from '../state/chartContext';

const ADD_INTERVAL = '__add-interval';
const BAR_OPTIONS = [500, 1000, 2000, 5000, 10000, 20000];

export function TopBar({
  onImportCsv,
  onOpenInbox,
  onOpenAlerts,
  pineToggleRef,
}: {
  onImportCsv: () => void;
  onOpenInbox: () => void;
  onOpenAlerts: () => void;
  pineToggleRef?: Ref<HTMLButtonElement>;
}) {
  const tier = topbarTier(useViewportSize().width);
  const chartStore = useChartStore();
  const providerInMore = tier === 'narrow' || tier === 'tiny';
  const importInMore = tier !== 'full';

  const providerId = useChart((s) => s.providerId);
  const timeframe = useChart((s) => s.timeframe);
  const bars = useChart((s) => s.bars);
  const loadState = useChart((s) => s.loadState);
  const activeAlerts = useAlerts((s) => s.alerts.filter((a) => a.status === 'active').length);
  const unread = useStore((s) => unreadCount(s.messages));
  const pineOpen = useStore((s) => s.pineOpen);
  const pineCount = useChart((s) => s.indicators.filter((i) => i.kind === 'pine').length);
  const pineRunning = useChart((s) => Object.values(s.pineRuns).some((r) => r.running));
  const togglePineEditor = useStore((s) => s.togglePineEditor);
  const live = useChart((s) => s.live);
  const candles = useChart(selectDataCandles);
  const replayOn = useChart((s) => s.replay != null);
  const hasBars = useChart((s) => s.candles.length >= 3);
  const chartRange = useChart((s) => s.chartRange);
  const timeZone = useStore((s) => s.timeZone);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const liveStatus = useChart((s) => s.liveStatus);
  const liveDetail = useChart((s) => s.liveDetail);
  const setProvider = useChart((s) => s.setProvider);
  const setTimeframe = useChart((s) => s.setTimeframe);
  const buildTimeframes = useStore((s) => s.buildTimeframes);
  /** The Bars menu only exists when everything loads at once; in scroll mode history pages in as the chart is scrolled. */
  const showBars = useStore((s) => s.historyLoading) === 'all';
  const customTimeframes = useStore((s) => s.customTimeframes);
  const [intervalOpen, setIntervalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setBuildTimeframes = useStore((s) => s.setBuildTimeframes);
  const setBars = useChart((s) => s.setBars);
  const loadData = useChart((s) => s.loadData);
  const setLive = useChart((s) => s.setLive);

  useEffect(() => {
    if (!live) return;
    setNow(Date.now() / 1000);
    const id = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(id);
  }, [live]);

  const rangeText = fmtDataRange(candles[0]?.time, candles[candles.length - 1]?.time, candles.length, { live: live && !chartRange, now, timeZone });

  const provider = getProvider(providerId);
  const source = buildTimeframes && !provider.offline ? 'built' : 'native';
  const pickerEntries = pickerTimeframes(provider, customTimeframes, source);

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
  const buildButton = (
    <button
      className={buildTimeframes ? 'build-toggle blue' : 'build-toggle'}
      style={{ cursor: 'pointer' }}
      aria-pressed={buildTimeframes}
      aria-label="Build higher timeframes from lower ones"
      title="Build higher timeframes from lower ones instead of the exchange's own bars"
      onClick={() => setBuildTimeframes(!buildTimeframes)}
    >
      Build
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
        const st = chartStore.getState();
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
      <LayoutPicker />
      {!providerInMore && <LayoutMenu />}
      <LayoutDialogs />
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
          onChange={(e) => (e.target.value === ADD_INTERVAL ? setIntervalOpen(true) : setTimeframe(e.target.value as Interval))}
          title="Timeframe"
        >
          {pickerEntries.map(({ interval, base }) => (
            <option key={interval} value={interval} title={base ? `Built from ${base}` : undefined}>
              {base ? `${interval} *` : interval}
            </option>
          ))}
          <option disabled>──────────</option>
          <option value={ADD_INTERVAL}>Add interval...</option>
        </select>
      </div>

      {!importInMore && !provider.offline && buildButton}

      {!importInMore && showBars && barsSelect}

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
        <button
          ref={pineToggleRef}
          className={`pine-toggle${pineOpen ? ' active' : ''}`}
          aria-pressed={pineOpen}
          aria-label="Pine Editor"
          title="Pine Editor"
          onClick={togglePineEditor}
        >
          <span aria-hidden="true">{'{ }'}</span>
          {tier === 'full' && <span className="btn-label">Pine Editor</span>}
          {pineRunning && <span className="spinner" />}
          {pineCount > 0 && <span className="badge">{pineCount}</span>}
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
                  <div className="more-row more-layout">
                    <span className="more-label">Layout</span>
                    <LayoutMenu inline onDone={close} />
                  </div>
                )}
                {providerInMore && (
                  <div className="more-row">
                    <span className="more-label">Provider</span>
                    {providerSelect}
                  </div>
                )}
                {!provider.offline && (
                  <div className="more-row">
                    <span className="more-label">Timeframes</span>
                    {buildButton}
                  </div>
                )}
                {showBars && (
                  <div className="more-row">
                    <span className="more-label">Bars</span>
                    {barsSelect}
                  </div>
                )}
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
        <button className="ghost icon inbox-btn" onClick={() => setSettingsOpen(true)} title="Vost settings" aria-label="Settings">
          <GearIcon />
        </button>
      </div>
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {intervalOpen && <IntervalDialog provider={provider} entries={pickerEntries} source={source} onClose={() => setIntervalOpen(false)} />}
    </header>
  );
}
