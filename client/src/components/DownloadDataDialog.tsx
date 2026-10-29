import { useState } from 'react';
import { candlesToCsv, downloadFile, sanitizeFileName } from '../lib/export';
import { selectDataCandles } from '../state/chart';
import { useStore } from '../state/store';
import { Modal } from './Modal';

/** Downloads the bars of the active chart, or of every chart, as CSV files named `<symbol>_<timeframe>.csv`. */
export function DownloadDataDialog({ onClose }: { onClose: () => void }) {
  const multi = useStore((s) => s.chartOrder.length > 1);
  const [scope, setScope] = useState<'active' | 'all'>('active');

  const download = () => {
    const s = useStore.getState();
    const ids = scope === 'all' ? s.chartOrder : [s.activeChartId];
    let count = 0;
    for (const id of ids) {
      const c = s.charts[id]?.getState();
      if (!c) continue;
      const candles = selectDataCandles(c);
      if (candles.length === 0) continue;
      downloadFile(sanitizeFileName(`${c.symbol}_${c.timeframe}.csv`), candlesToCsv(candles));
      count++;
    }
    if (count === 0) s.pushToast('info', 'No chart has data to download yet.');
    onClose();
  };

  return (
    <Modal
      title="Download chart data"
      onClose={onClose}
      width={380}
      footer={
        <>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={download}>
            Download
          </button>
        </>
      }
    >
      <div className="lm-radios" role="radiogroup" aria-label="Charts to download">
        <label>
          <input type="radio" name="lm-scope" checked={scope === 'active'} onChange={() => setScope('active')} /> Active chart
        </label>
        <label className={multi ? '' : 'disabled'}>
          <input type="radio" name="lm-scope" checked={scope === 'all'} disabled={!multi} onChange={() => setScope('all')} /> All charts
        </label>
      </div>
    </Modal>
  );
}
