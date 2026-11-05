import { useEffect, useState } from 'react';
import { fmtDataRange } from '../lib/format';
import { getProvider } from '../lib/providers';
import { selectDataCandles } from '../state/chart';
import { useChart } from '../state/chartContext';
import { useStore } from '../state/store';
import { DatabaseIcon, RefreshIcon } from './Icons';
import { TopBarPopover } from './TopBarMore';

const BAR_OPTIONS = [500, 1000, 2000, 5000, 10000, 20000];

/** The top bar's "Chart data" button: its pop-up holds the loaded range, the bar count, Build and Load. */
export function TopBarData() {
  const providerId = useChart((s) => s.providerId);
  const bars = useChart((s) => s.bars);
  const loadState = useChart((s) => s.loadState);
  const live = useChart((s) => s.live);
  const candles = useChart(selectDataCandles);
  const chartRange = useChart((s) => s.chartRange);
  const timeZone = useStore((s) => s.timeZone);
  const buildTimeframes = useStore((s) => s.buildTimeframes);
  const setBuildTimeframes = useStore((s) => s.setBuildTimeframes);
  /** The Bars menu only exists when everything loads at once; in scroll mode history pages in as the chart is scrolled. */
  const showBars = useStore((s) => s.historyLoading) === 'all';
  const setBars = useChart((s) => s.setBars);
  const loadData = useChart((s) => s.loadData);
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    if (!live) return;
    setNow(Date.now() / 1000);
    const id = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(id);
  }, [live]);

  const provider = getProvider(providerId);
  const loading = loadState === 'loading';
  const rangeText = fmtDataRange(candles[0]?.time, candles[candles.length - 1]?.time, candles.length, { live: live && !chartRange, now, timeZone });

  return (
    <TopBarPopover
      label="Chart data"
      title={rangeText || 'Chart data'}
      icon={loading ? <span className="spinner" /> : <DatabaseIcon />}
      align="left"
      className="topbar-data-pop"
    >
      {() => (
        <>
          <div className="more-row">
            <span className="more-label">Range</span>
            <span className="data-range">{rangeText || 'No data loaded'}</span>
          </div>
          {showBars && (
            <div className="more-row">
              <span className="more-label">Bars</span>
              <div className="field">
                <select value={bars} onChange={(e) => setBars(Number(e.target.value))} title="Number of bars to request" aria-label="Number of bars">
                  {BAR_OPTIONS.map((b) => (
                    <option key={b} value={b}>
                      {b >= 1000 ? `${b / 1000}k bars` : `${b} bars`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {!provider.offline && (
            <div className="more-row">
              <span className="more-label">Timeframes</span>
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
            </div>
          )}
          <div className="more-row">
            <button className="primary" onClick={() => void loadData()} disabled={loading} title="Reload data" aria-label="Load">
              {loading ? (
                <span className="spinner" />
              ) : (
                <>
                  <RefreshIcon />
                  <span className="btn-label">Load</span>
                </>
              )}
            </button>
          </div>
        </>
      )}
    </TopBarPopover>
  );
}
