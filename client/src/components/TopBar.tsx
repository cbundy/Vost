import { PROVIDER_GITHUB_URL } from '../lib/constants';
import { getProvider, providers } from '../lib/providers';
import { TIMEFRAMES } from '../types';
import { unreadCount } from '../lib/messages';
import { useStore } from '../state/store';
import { SymbolSearch } from './SymbolSearch';

const BAR_OPTIONS = [500, 1000, 2000, 5000, 10000, 20000];

export function TopBar({
  onImportCsv,
  onToggleSidebar,
  onOpenInbox,
}: {
  onImportCsv: () => void;
  onToggleSidebar: () => void;
  onOpenInbox: () => void;
}) {
  const providerId = useStore((s) => s.providerId);
  const timeframe = useStore((s) => s.timeframe);
  const bars = useStore((s) => s.bars);
  const loadState = useStore((s) => s.loadState);
  const unread = useStore((s) => unreadCount(s.messages));
  const live = useStore((s) => s.live);
  const liveStatus = useStore((s) => s.liveStatus);
  const liveDetail = useStore((s) => s.liveDetail);
  const setProvider = useStore((s) => s.setProvider);
  const setTimeframe = useStore((s) => s.setTimeframe);
  const setBars = useStore((s) => s.setBars);
  const loadData = useStore((s) => s.loadData);
  const setLive = useStore((s) => s.setLive);

  const provider = getProvider(providerId);
  const timeframes = TIMEFRAMES.filter((tf) => provider.timeframes.includes(tf));

  const liveClass = liveStatus === 'live' ? '' : liveStatus === 'connecting' || liveStatus === 'reconnecting' ? 'connecting' : 'error';

  return (
    <header className="topbar">
      <button className="ghost icon" title="Toggle sidebar" onClick={onToggleSidebar}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <line x1="9" y1="4" x2="9" y2="20" />
        </svg>
      </button>

      <div className="brand" title="Vost — open-source charts & backtesting">
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
        <span className="brand-tag">self-hosted charts &amp; backtesting</span>
      </div>

      <div className="topbar-sep" />

      <div className="field">
        <select value={providerId} onChange={(e) => setProvider(e.target.value)} title={provider.description}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

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

      <div className="field">
        <select value={bars} onChange={(e) => setBars(Number(e.target.value))} title="Number of bars to request">
          {BAR_OPTIONS.map((b) => (
            <option key={b} value={b}>
              {b >= 1000 ? `${b / 1000}k bars` : `${b} bars`}
            </option>
          ))}
        </select>
      </div>

      <button className="primary" onClick={() => void loadData()} disabled={loadState === 'loading'} title="Reload data">
        {loadState === 'loading' ? <span className="spinner" /> : 'Load'}
      </button>

      {provider.supportsLive && (
        <button
          className={live ? 'badge green' : 'badge'}
          style={{ cursor: 'pointer' }}
          onClick={() => (liveStatus === 'error' ? onOpenInbox() : setLive(!live))}
          title={liveStatus === 'error' ? `${liveDetail} - click to open the inbox` : liveDetail || 'Stream live candles from Binance'}
        >
          <span className={`live-dot ${liveClass}`} style={{ marginRight: 6 }} />
          {liveStatus === 'live' ? 'LIVE' : liveStatus === 'connecting' ? '…' : liveStatus === 'reconnecting' ? 'RETRY' : liveStatus === 'error' ? 'ERR' : 'Live'}
        </button>
      )}

      <div className="topbar-right">
        <button className="ghost icon inbox-btn" onClick={onOpenInbox} title="Inbox (messages and errors)" aria-label="Inbox">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 12h-6l-2 3h-4l-2-3H2" />
            <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
          </svg>
          {unread > 0 && <span className="inbox-badge">{unread > 99 ? '99+' : unread}</span>}
        </button>
        <button onClick={onImportCsv} title="Import OHLCV CSV — works fully offline">
          ⬆ Import CSV
        </button>
        <a
          className="badge"
          href={PROVIDER_GITHUB_URL}
          target="_blank"
          rel="noreferrer"
          title="Star Vost on GitHub"
          style={{ padding: '5px 10px' }}
        >
          ★ GitHub
        </a>
      </div>
    </header>
  );
}
