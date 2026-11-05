import { useState, type Ref } from 'react';
import { APP_VERSION, PROVIDER_GITHUB_URL } from '../lib/constants';
import { liveIndicator } from '../lib/liveIndicator';
import { topbarTier } from '../lib/paneSizes';
import { useViewportSize } from '../lib/useViewportSize';
import { getProvider, providers } from '../lib/providers';
import { pickerTimeframes } from '../lib/customTimeframes';
import { IntervalDialog } from './IntervalDialog';
import { unreadCount } from '../lib/messages';
import { useAlerts } from '../state/alerts';
import { useStore } from '../state/store';
import { ChartRangeControl } from './ChartRangeControl';
import { BellIcon, GearIcon, InboxIcon, ReplayIcon, StarIcon, UploadIcon } from './Icons';
import { ConnectionStatus } from './ConnectionStatus';
import { LayoutDialogs } from './LayoutDialogs';
import { LayoutMenu } from './LayoutMenu';
import { LayoutPicker } from './LayoutPicker';
import { SettingsDialog } from './SettingsDialog';
import { SymbolSearch } from './SymbolSearch';
import { TopBarData } from './TopBarData';
import { TopBarMore } from './TopBarMore';
import type { Interval } from '../types';
import { useActiveDrawings } from './chart/activeDrawings';
import { useChart, useChartStore } from '../state/chartContext';

const ADD_INTERVAL = '__add-interval';

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
  const viewportW = useViewportSize().width;
  const tier = topbarTier(viewportW);
  const chartStore = useChartStore();
  const providerInMore = tier === 'narrow' || tier === 'tiny';
  const importInMore = tier !== 'full';
  /** Undo and Redo sit in the More menu once the row has no room for them (a tablet and below). */
  const undoInMore = viewportW <= UNDO_IN_MORE_MAX;
  const drawingsEntry = useActiveDrawings();

  const providerId = useChart((s) => s.providerId);
  const timeframe = useChart((s) => s.timeframe);
  const activeAlerts = useAlerts((s) => s.alerts.filter((a) => a.status === 'active').length);
  const unread = useStore((s) => unreadCount(s.messages));
  const pineOpen = useStore((s) => s.pineOpen);
  const pineCount = useChart((s) => s.indicators.filter((i) => i.kind === 'pine').length);
  const pineRunning = useChart((s) => Object.values(s.pineRuns).some((r) => r.running));
  const togglePineEditor = useStore((s) => s.togglePineEditor);
  const live = useChart((s) => s.live);
  const replayOn = useChart((s) => s.replay != null);
  const hasBars = useChart((s) => s.candles.length >= 3);
  const liveStatus = useChart((s) => s.liveStatus);
  const liveDetail = useChart((s) => s.liveDetail);
  const setProvider = useChart((s) => s.setProvider);
  const setTimeframe = useChart((s) => s.setTimeframe);
  const buildTimeframes = useStore((s) => s.buildTimeframes);
  const customTimeframes = useStore((s) => s.customTimeframes);
  const [intervalOpen, setIntervalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const setLive = useChart((s) => s.setLive);

  const provider = getProvider(providerId);
  const source = buildTimeframes && !provider.offline ? 'built' : 'native';
  const pickerEntries = pickerTimeframes(provider, customTimeframes, source);

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
  const liveInfo = liveIndicator(liveStatus, liveDetail);
  const liveButton = provider.supportsLive && (
    <button
      className={`badge live-btn${live ? ' green' : ''}`}
      style={{ cursor: 'pointer' }}
      data-live-status={liveStatus}
      aria-label={liveInfo.label}
      title={liveInfo.label}
      onClick={() => (liveStatus === 'error' ? onOpenInbox() : setLive(!live))}
    >
      <span className={`live-dot ${liveInfo.dotClass}`} />
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
  /** Undo and Redo for the active chart's drawings, the same as Ctrl+Z and Ctrl+Shift+Z. */
  const undoButtons = (
    <>
      <button className="ghost icon" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!drawingsEntry?.canUndo} onClick={() => drawingsEntry?.actions.undo()}>
        <UndoIcon />
      </button>
      <button className="ghost icon" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!drawingsEntry?.canRedo} onClick={() => drawingsEntry?.actions.redo()}>
        <RedoIcon />
      </button>
    </>
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

      <TopBarData />

      {!providerInMore && liveButton}

      {!providerInMore && replayButton()}

      {!undoInMore && undoButtons}

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
                {undoInMore && (
                  <div className="more-row">
                    <span className="more-label">Undo</span>
                    {undoButtons}
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
