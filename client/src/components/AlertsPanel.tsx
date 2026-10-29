import { useState, type FormEvent } from 'react';
import { ALERT_CONDITIONS, type Alert, type AlertCondition } from '../../../shared/alerts.ts';
import {
  CONDITION_LABEL,
  createAlert,
  deleteAlert,
  editAlert,
  fmtLevel,
  sendTelegramTest,
} from '../lib/alerts';
import { fmtTime } from '../lib/format';
import { providers } from '../lib/providers';
import { useAlerts } from '../state/alerts';
import { useStore } from '../state/store';
import { Modal } from './Modal';
import { useChart } from '../state/chartContext';

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

function Telegram({ configured }: { configured: boolean | null }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  if (configured === null) return null;
  if (!configured) {
    return (
      <div className="alerts-telegram" data-testid="telegram-line">
        Telegram is off: set <code>VOST_TELEGRAM_BOT_TOKEN</code> and <code>VOST_TELEGRAM_CHAT_ID</code> on the server to get alerts on your phone.
      </div>
    );
  }
  return (
    <div className="alerts-telegram" data-testid="telegram-line">
      <span>Telegram is on</span>
      <button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setResult(null);
          sendTelegramTest()
            .then(() => setResult({ ok: true, text: 'Test message sent' }))
            .catch((err: unknown) => setResult({ ok: false, text: message(err) }))
            .finally(() => setBusy(false));
        }}
      >
        Send test message
      </button>
      {result && (
        <span className={result.ok ? 'alerts-ok' : 'alerts-error'} role="status">
          {result.text}
        </span>
      )}
    </div>
  );
}

function AlertRow({ alert, timeZone, onError }: { alert: Alert; timeZone: string; onError: (text: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [condition, setCondition] = useState<AlertCondition>(alert.condition);
  const [level, setLevel] = useState(String(alert.level));
  const [note, setNote] = useState(alert.note);
  const [busy, setBusy] = useState(false);
  const upsert = useAlerts((s) => s.upsert);
  const remove = useAlerts((s) => s.remove);
  const when = (ms: number): string => fmtTime(ms / 1000, { timeZone });

  const save = (): void => {
    const n = Number(level);
    if (level.trim() === '' || !Number.isFinite(n)) return onError('Level must be a number');
    setBusy(true);
    onError(null);
    editAlert(alert.id, { condition, level: n, note })
      .then((a) => {
        upsert(a);
        setEditing(false);
      })
      .catch((err: unknown) => onError(message(err)))
      .finally(() => setBusy(false));
  };
  const del = (): void => {
    setBusy(true);
    onError(null);
    deleteAlert(alert.id)
      .then(() => remove(alert.id))
      .catch((err: unknown) => onError(message(err)))
      .finally(() => setBusy(false));
  };

  return (
    <li className={`alerts-item ${alert.status}`} data-testid="alert-row">
      <div className="alerts-item-head">
        <b>{alert.symbol}</b>
        <span className="muted-2">{alert.provider}</span>
        <span>
          {CONDITION_LABEL[alert.condition]} {fmtLevel(alert.level)}
        </span>
        <span className={`alerts-status ${alert.status}`}>{alert.status === 'active' ? 'Active' : 'Triggered'}</span>
      </div>
      {alert.note && <div className="alerts-note">{alert.note}</div>}
      <div className="alerts-meta muted-2">Created {when(alert.createdAt)}</div>
      {alert.status === 'triggered' && alert.triggeredAt != null && (
        <div className="alerts-meta">
          Triggered {when(alert.triggeredAt)}
          {alert.triggerPrice != null ? ` at ${fmtLevel(alert.triggerPrice)}` : ''}
          {' - '}
          {alert.telegram === 'sent' && 'Telegram: sent'}
          {alert.telegram === 'failed' && `Telegram: failed${alert.telegramError ? ` (${alert.telegramError})` : ''}`}
          {(alert.telegram === 'off' || !alert.telegram) && 'Telegram: off'}
        </div>
      )}
      {editing ? (
        <div className="alerts-edit">
          <select aria-label="Condition" value={condition} onChange={(e) => setCondition(e.target.value as AlertCondition)}>
            {ALERT_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABEL[c]}
              </option>
            ))}
          </select>
          <input aria-label="Level" type="number" step="any" value={level} onChange={(e) => setLevel(e.target.value)} />
          <input aria-label="Note" type="text" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          <button className="primary" disabled={busy} onClick={save}>
            {alert.status === 'triggered' ? 'Save and re-arm' : 'Save'}
          </button>
          <button disabled={busy} onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <div className="alerts-actions">
          <button disabled={busy} onClick={() => setEditing(true)}>
            Edit
          </button>
          <button disabled={busy} onClick={del}>
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

export function AlertsPanel({ onClose, initialLevel }: { onClose: () => void; initialLevel?: number }) {
  const chartProvider = useChart((s) => s.providerId);
  const chartSymbol = useChart((s) => s.symbol);
  const datasetActive = useChart((s) => s.activeDatasetId != null);
  const timeZone = useStore((s) => s.timeZone);
  const alerts = useAlerts((s) => s.alerts);
  const telegram = useAlerts((s) => s.telegramConfigured);
  const sound = useAlerts((s) => s.sound);
  const setSound = useAlerts((s) => s.setSound);
  const upsert = useAlerts((s) => s.upsert);

  const serverProviders = providers.filter((p) => !p.offline);
  const clientOnly = datasetActive || !serverProviders.some((p) => p.id === chartProvider);

  const [provider, setProvider] = useState(chartProvider);
  const [symbol, setSymbol] = useState(chartSymbol);
  const [condition, setCondition] = useState<AlertCondition>('crossing-up');
  const [level, setLevel] = useState(initialLevel != null ? String(initialLevel) : '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (ev: FormEvent): void => {
    ev.preventDefault();
    const n = Number(level);
    if (level.trim() === '' || !Number.isFinite(n)) return setError('Level must be a number');
    setBusy(true);
    setError(null);
    createAlert({ provider, symbol: symbol.trim(), condition, level: n, note })
      .then((a) => {
        upsert(a);
        setLevel('');
        setNote('');
      })
      .catch((err: unknown) => setError(message(err)))
      .finally(() => setBusy(false));
  };

  const ordered = [...alerts].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Modal
      title="Alerts"
      onClose={onClose}
      width={640}
      footer={
        <>
          <label className="alerts-sound">
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} /> Sound
          </label>
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <Telegram configured={telegram} />
      {error && (
        <div className="alerts-error" role="alert" data-testid="alerts-error">
          {error}
        </div>
      )}
      {clientOnly ? (
        <div className="alerts-empty" data-testid="alerts-client-only">
          Alerts need a server provider. Pick Binance, Coinbase or another exchange to add one.
        </div>
      ) : (
        <form className="alerts-form" onSubmit={submit}>
          <select aria-label="Provider" value={provider} onChange={(e) => setProvider(e.target.value)}>
            {serverProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input aria-label="Symbol" type="text" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          <select aria-label="Condition" value={condition} onChange={(e) => setCondition(e.target.value as AlertCondition)}>
            {ALERT_CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABEL[c]}
              </option>
            ))}
          </select>
          <input aria-label="Level" type="number" step="any" placeholder="Level" value={level} onChange={(e) => setLevel(e.target.value)} />
          <input aria-label="Note" type="text" placeholder="Note (optional)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="primary" type="submit" disabled={busy}>
            Add alert
          </button>
        </form>
      )}
      {ordered.length === 0 ? (
        <div className="alerts-empty">No alerts yet.</div>
      ) : (
        <ul className="alerts-list">
          {ordered.map((a) => (
            <AlertRow key={a.id} alert={a} timeZone={timeZone} onError={setError} />
          ))}
        </ul>
      )}
    </Modal>
  );
}
