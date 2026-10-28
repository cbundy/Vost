import { useAlerts } from '../state/alerts';

/** One card per fired alert, newest on top, until dismissed. */
export function AlertPopup({ onOpenAlerts }: { onOpenAlerts: () => void }) {
  const popups = useAlerts((s) => s.popups);
  const dismiss = useAlerts((s) => s.dismissPopup);
  if (popups.length === 0) return null;
  return (
    <div className="alert-popups">
      {popups.map((p) => (
        <div key={p.key} className="alert-popup" role="alert">
          <div className="alert-popup-title">Alert fired</div>
          <div className="alert-popup-text">{p.text}</div>
          <div className="alert-popup-actions">
            <button
              className="primary"
              onClick={() => {
                dismiss(p.key);
                onOpenAlerts();
              }}
            >
              Open alerts
            </button>
            <button onClick={() => dismiss(p.key)}>Dismiss</button>
          </div>
        </div>
      ))}
    </div>
  );
}
